import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { z } from 'zod';
import { pool, withTransaction } from './db.js';

const required = ['JWT_SECRET', 'APP_ORIGIN'];
const missing = required.filter((key) => !process.env[key] || process.env[key].startsWith('CHANGE_ME'));
if (missing.length) throw new Error(`Set non-placeholder environment variables: ${missing.join(', ')}`);

const app = express();
const port = Number(process.env.PORT || process.env.BACKEND_PORT || 5000);
const allowedOrigins = process.env.APP_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
const uploadDirectory = path.resolve('uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not permitted'));
}, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 900000),
  limit: Number(process.env.RATE_LIMIT_MAX || 200),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests. Please try again later.' }
}));
app.use('/uploads', express.static(uploadDirectory, { index: false, fallthrough: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, uploadDirectory),
    filename: (_request, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: Number(process.env.UPLOAD_MAX_MB || 5) * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const permittedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
    const permittedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
    if (!permittedMimeTypes.has(file.mimetype) || !permittedExtensions.has(path.extname(file.originalname).toLowerCase())) {
      return callback(new Error('Only PDF, JPG, JPEG, and PNG supporting documents are allowed.'));
    }
    return callback(null, true);
  }
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  portal: z.enum(['student', 'faculty', 'admin']).optional()
});
const leaveSchema = z.object({
  leaveType: z.string().trim().min(2).max(64),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().trim().min(10).max(4000),
  emergency: z.boolean().default(false),
  contactInformation: z.string().trim().max(255).optional()
});
const studentSchema = z.object({
  studentId: z.string().trim().min(3).max(64),
  enrollmentNo: z.string().trim().min(3).max(64),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().email().max(255),
  temporaryPassword: z.string().min(12).max(200),
  phone: z.string().trim().max(32).optional().nullable(),
  schoolId: z.coerce.number().int().positive(),
  departmentId: z.coerce.number().int().positive(),
  programId: z.coerce.number().int().positive(),
  semester: z.coerce.number().int().min(1).max(16),
  section: z.string().trim().min(1).max(16),
  academicYear: z.string().trim().min(4).max(32),
  admissionYear: z.coerce.number().int().min(1900).max(2200),
  facultyId: z.coerce.number().int().positive().optional().nullable(),
  attendancePercentage: z.coerce.number().min(0).max(100).default(100),
  totalLeaveQuota: z.coerce.number().min(0).max(365).default(20)
});
const studentUpdateSchema = studentSchema.omit({ temporaryPassword: true }).partial();

function getValidation(schema, input) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map((issue) => issue.message).join('; '));
    error.status = 422;
    throw error;
  }
  return parsed.data;
}

function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
}

async function getUser(userId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.role, u.status, u.must_change_password,
      s.id AS student_profile_id, s.student_id, s.enrollment_no, s.first_name, s.last_name,
      f.id AS faculty_profile_id, f.faculty_id, f.name AS faculty_name,
      a.id AS admin_profile_id, a.name AS admin_name
     FROM users u
     LEFT JOIN students s ON s.user_id = u.id
     LEFT JOIN faculty f ON f.user_id = u.id
     LEFT JOIN admins a ON a.user_id = u.id
     WHERE u.id = ?`, [userId]
  );
  return rows[0] || null;
}

async function authenticate(request, response, next) {
  try {
    const token = request.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return response.status(401).json({ message: 'Authentication is required.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await getUser(payload.sub);
    if (!user || user.status !== 'active') return response.status(401).json({ message: 'This account cannot access the application.' });
    request.user = user;
    return next();
  } catch (_error) {
    return response.status(401).json({ message: 'Your session is invalid or has expired.' });
  }
}

function authorize(...roles) {
  return (request, response, next) => roles.includes(request.user.role)
    ? next()
    : response.status(403).json({ message: 'You are not authorized for this action.' });
}

async function notify(connection, userId, title, message) {
  if (!userId) return;
  await connection.execute('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)', [userId, title, message]);
}

async function audit(connection, actorUserId, action, entityType, entityId, details = {}) {
  await connection.execute(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [actorUserId, action, entityType, entityId || null, JSON.stringify(details)]
  );
}

function inclusiveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86400000) + 1;
}

async function ensureAcademicRelationship(connection, values) {
  const [[program]] = await connection.execute(
    'SELECT id FROM programs WHERE id = ? AND school_id = ? AND department_id = ? AND status = \'active\'',
    [values.programId, values.schoolId, values.departmentId]
  );
  if (!program) {
    const error = new Error('The selected school, department, and program do not form an active academic relationship.');
    error.status = 422;
    throw error;
  }
  if (values.facultyId) {
    const [[faculty]] = await connection.execute('SELECT id FROM faculty WHERE id = ? AND status = \'active\'', [values.facultyId]);
    if (!faculty) {
      const error = new Error('The selected faculty member is not active.');
      error.status = 422;
      throw error;
    }
  }
}

function studentSelect() {
  return `SELECT s.id, s.student_id AS studentId, s.enrollment_no AS enrollmentNo, s.first_name AS firstName, s.last_name AS lastName,
    s.email, s.phone, s.semester, s.section, s.academic_year AS academicYear, s.admission_year AS admissionYear,
    s.attendance_percentage AS attendancePercentage, s.total_leave_quota AS totalLeaveQuota, s.used_leave AS usedLeave,
    s.remaining_leave AS remainingLeave, s.account_status AS accountStatus, s.created_at AS createdAt,
    sc.id AS schoolId, sc.school_name AS schoolName, d.id AS departmentId, d.department_name AS departmentName,
    p.id AS programId, p.program_name AS programName, f.id AS facultyId, f.name AS facultyName
    FROM students s
    JOIN schools sc ON sc.id = s.school_id JOIN departments d ON d.id = s.department_id JOIN programs p ON p.id = s.program_id
    LEFT JOIN faculty f ON f.id = s.faculty_id`;
}

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const { email, password, portal } = getValidation(loginSchema, request.body);
    const [rows] = await pool.execute('SELECT id, email, password_hash, role, status, must_change_password FROM users WHERE email = ?', [email.toLowerCase()]);
    const account = rows[0];
    if (!account || account.status !== 'active' || (portal && portal !== account.role) || !(await bcrypt.compare(password, account.password_hash))) {
      return response.status(401).json({ message: 'Invalid credentials or portal.' });
    }
    const user = await getUser(account.id);
    return response.json({ token: signToken(account), user: publicUser(user) });
  } catch (error) { return next(error); }
});

app.get('/api/auth/me', authenticate, (request, response) => response.json({ user: publicUser(request.user) }));

app.post('/api/auth/change-password', authenticate, async (request, response, next) => {
  try {
    const input = getValidation(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) }), request.body);
    const [[account]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [request.user.id]);
    if (!(await bcrypt.compare(input.currentPassword, account.password_hash))) return response.status(401).json({ message: 'Current password is incorrect.' });
    await pool.execute('UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?', [await bcrypt.hash(input.newPassword, 12), request.user.id]);
    return response.status(204).send();
  } catch (error) { return next(error); }
});

app.get('/api/notifications', authenticate, async (request, response, next) => {
  try {
    const [rows] = await pool.execute('SELECT id, title, message, read_status AS readStatus, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [request.user.id]);
    response.json({ items: rows });
  } catch (error) { next(error); }
});

app.get('/api/student/dashboard', authenticate, authorize('student'), async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `${studentSelect()} WHERE s.id = ?`, [request.user.student_profile_id]
    );
    const [leaveCounts] = await pool.execute(
      `SELECT status, COUNT(*) AS count FROM leave_applications WHERE student_id = ? GROUP BY status`, [request.user.student_profile_id]
    );
    response.json({ profile: rows[0], leaveCounts: Object.fromEntries(leaveCounts.map((row) => [row.status, row.count])) });
  } catch (error) { next(error); }
});

app.get('/api/student/leaves', authenticate, authorize('student'), async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, leave_type AS leaveType, start_date AS startDate, end_date AS endDate, days, reason, document, emergency,
       contact_information AS contactInformation, status, created_at AS createdAt, updated_at AS updatedAt
       FROM leave_applications WHERE student_id = ? ORDER BY created_at DESC`, [request.user.student_profile_id]
    );
    response.json({ items: rows });
  } catch (error) { next(error); }
});

app.get('/api/student/leave-policies', authenticate, authorize('student'), async (_request, response, next) => {
  try {
    const [items] = await pool.query(
      `SELECT id, leave_type AS leaveType, maximum_days AS maximumDays, minimum_attendance AS minimumAttendance,
       document_required AS documentRequired FROM leave_policies WHERE status = 'active' ORDER BY leave_type`
    );
    response.json({ items });
  } catch (error) { next(error); }
});

app.post('/api/student/leaves', authenticate, authorize('student'), upload.single('document'), async (request, response, next) => {
  try {
    const values = getValidation(leaveSchema, { ...request.body, emergency: request.body.emergency === true || request.body.emergency === 'true' });
    const days = inclusiveDays(values.startDate, values.endDate);
    if (!Number.isFinite(days) || days <= 0 || days > 365) throw Object.assign(new Error('Choose a valid leave date range.'), { status: 422 });
    const leave = await withTransaction(async (connection) => {
      const [[student]] = await connection.execute('SELECT * FROM students WHERE id = ? FOR UPDATE', [request.user.student_profile_id]);
      const [[policy]] = await connection.execute('SELECT * FROM leave_policies WHERE leave_type = ? AND status = \'active\'', [values.leaveType]);
      if (!policy) throw Object.assign(new Error('This leave type is not available.'), { status: 422 });
      if (days > Number(policy.maximum_days)) throw Object.assign(new Error('This request exceeds the policy maximum.'), { status: 422 });
      if (Number(student.attendance_percentage) < Number(policy.minimum_attendance)) throw Object.assign(new Error('Your attendance does not meet this leave policy.'), { status: 422 });
      if (policy.document_required && !request.file) throw Object.assign(new Error('A supporting document is required for this leave type.'), { status: 422 });
      if (Number(student.remaining_leave) < days) throw Object.assign(new Error('The request exceeds your remaining leave balance.'), { status: 422 });
      const [overlap] = await connection.execute(
        `SELECT id FROM leave_applications WHERE student_id = ? AND status IN ('pending', 'under_review', 'clarification_requested', 'approved')
         AND start_date <= ? AND end_date >= ? LIMIT 1`, [student.id, values.endDate, values.startDate]
      );
      if (overlap.length) throw Object.assign(new Error('This request overlaps an existing leave application.'), { status: 409 });
      const [result] = await connection.execute(
        `INSERT INTO leave_applications (student_id, leave_type, start_date, end_date, days, reason, document, emergency, contact_information)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [student.id, values.leaveType, values.startDate, values.endDate, days, values.reason, request.file?.filename || null, values.emergency, values.contactInformation || null]
      );
      if (student.faculty_id) {
        const [[faculty]] = await connection.execute('SELECT user_id FROM faculty WHERE id = ?', [student.faculty_id]);
        await notify(connection, faculty?.user_id, 'New leave request', `${student.first_name} ${student.last_name} submitted a ${values.leaveType} leave request.`);
      }
      await notify(connection, request.user.id, 'Leave submitted', 'Your leave application was submitted for review.');
      return result.insertId;
    });
    response.status(201).json({ id: leave, message: 'Leave application submitted for review.' });
  } catch (error) { next(error); }
});

app.get('/api/student/attendance', authenticate, authorize('student'), async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT subject, SUM(status = 'present') AS present, SUM(status = 'absent') AS absent, SUM(status = 'leave') AS onLeave,
        ROUND(100 * SUM(status = 'present') / NULLIF(COUNT(*), 0), 2) AS percentage
       FROM attendance WHERE student_id = ? GROUP BY subject ORDER BY subject`, [request.user.student_profile_id]
    );
    response.json({ items: rows });
  } catch (error) { next(error); }
});

app.post('/api/student/assistant', authenticate, authorize('student'), async (request, response, next) => {
  try {
    const { question } = getValidation(z.object({ question: z.string().trim().min(2).max(1000) }), request.body);
    const [[student]] = await pool.execute('SELECT attendance_percentage, remaining_leave, total_leave_quota, used_leave FROM students WHERE id = ?', [request.user.student_profile_id]);
    const [recent] = await pool.execute('SELECT leave_type, status, start_date, end_date FROM leave_applications WHERE student_id = ? ORDER BY created_at DESC LIMIT 3', [request.user.student_profile_id]);
    const reply = `Your authorized record shows ${student.remaining_leave} leave days remaining out of ${student.total_leave_quota}, ${student.used_leave} days used, and ${student.attendance_percentage}% attendance. Recent leave requests: ${recent.length ? recent.map((leave) => `${leave.leave_type} (${leave.status})`).join(', ') : 'none'}. Your question was: ${question}. This assistant can explain your information but cannot approve or reject leave.`;
    response.json({ reply, source: 'controlled-student-data' });
  } catch (error) { next(error); }
});

app.get('/api/faculty/dashboard', authenticate, authorize('faculty'), async (request, response, next) => {
  try {
    const [[faculty]] = await pool.execute('SELECT id, name, faculty_id AS facultyId, department_id AS departmentId FROM faculty WHERE user_id = ?', [request.user.id]);
    const [[metrics]] = await pool.execute(
      `SELECT COUNT(DISTINCT s.id) AS assignedStudents,
       SUM(l.status = 'pending') AS pendingLeaves, SUM(l.status = 'approved') AS approvedLeaves, SUM(l.status = 'rejected') AS rejectedLeaves,
       ROUND(AVG(s.attendance_percentage), 2) AS averageAttendance
       FROM students s LEFT JOIN leave_applications l ON l.student_id = s.id WHERE s.faculty_id = ?`, [faculty.id]
    );
    response.json({ faculty, metrics });
  } catch (error) { next(error); }
});

app.get('/api/faculty/leaves', authenticate, authorize('faculty'), async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT l.id, l.leave_type AS leaveType, l.start_date AS startDate, l.end_date AS endDate, l.days, l.reason, l.document, l.emergency, l.status, l.created_at AS createdAt,
       s.id AS studentId, s.student_id AS studentCode, s.enrollment_no AS enrollmentNo, CONCAT(s.first_name, ' ', s.last_name) AS studentName, s.attendance_percentage AS attendancePercentage
       FROM leave_applications l JOIN students s ON s.id = l.student_id JOIN faculty f ON f.id = s.faculty_id
       WHERE f.user_id = ? ORDER BY l.created_at DESC`, [request.user.id]
    );
    response.json({ items: rows });
  } catch (error) { next(error); }
});

app.post('/api/faculty/leaves/:id/action', authenticate, authorize('faculty'), async (request, response, next) => {
  try {
    const leaveId = Number(request.params.id);
    if (!Number.isSafeInteger(leaveId) || leaveId <= 0) return response.status(422).json({ message: 'Invalid leave ID.' });
    const { action, remarks } = getValidation(z.object({
      action: z.enum(['approved', 'rejected', 'clarification_requested']),
      remarks: z.string().trim().max(4000).optional()
    }).superRefine((value, ctx) => { if (value.action === 'rejected' && !value.remarks) ctx.addIssue({ code: 'custom', message: 'A rejection reason is required.' }); }), request.body);
    await withTransaction(async (connection) => {
      const [[leave]] = await connection.execute(
        `SELECT l.*, s.user_id AS student_user_id, s.faculty_id, s.total_leave_quota, s.used_leave
         FROM leave_applications l JOIN students s ON s.id = l.student_id WHERE l.id = ? FOR UPDATE`, [leaveId]
      );
      if (!leave) throw Object.assign(new Error('Leave application not found.'), { status: 404 });
      const [[faculty]] = await connection.execute('SELECT id FROM faculty WHERE user_id = ?', [request.user.id]);
      if (!faculty || faculty.id !== leave.faculty_id) throw Object.assign(new Error('This leave application is not assigned to you.'), { status: 403 });
      if (!['pending', 'under_review', 'clarification_requested'].includes(leave.status)) throw Object.assign(new Error('This leave application has already been finalized.'), { status: 409 });
      if (action === 'approved' && Number(leave.used_leave) + Number(leave.days) > Number(leave.total_leave_quota)) {
        throw Object.assign(new Error('Approval would exceed the student leave quota.'), { status: 422 });
      }
      await connection.execute('UPDATE leave_applications SET status = ? WHERE id = ?', [action, leaveId]);
      await connection.execute('INSERT INTO leave_approvals (leave_id, approver_id, action, remarks) VALUES (?, ?, ?, ?)', [leaveId, request.user.id, action, remarks || null]);
      if (action === 'approved') await connection.execute('UPDATE students SET used_leave = used_leave + ? WHERE id = ?', [leave.days, leave.student_id]);
      await notify(connection, leave.student_user_id, `Leave ${action.replace('_', ' ')}`, remarks || `Your leave application was ${action.replace('_', ' ')}.`);
    });
    response.json({ message: `Leave application ${action.replace('_', ' ')}.` });
  } catch (error) { next(error); }
});

app.get('/api/admin/dashboard', authenticate, authorize('admin'), async (_request, response, next) => {
  try {
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM students) AS totalStudents,
        (SELECT COUNT(*) FROM students WHERE account_status = 'active') AS activeStudents,
        (SELECT COUNT(*) FROM students WHERE account_status = 'inactive') AS inactiveStudents,
        (SELECT COUNT(*) FROM students WHERE account_status = 'blocked') AS blockedStudents,
        (SELECT COUNT(*) FROM faculty WHERE status = 'active') AS totalFaculty,
        (SELECT COUNT(*) FROM schools WHERE status = 'active') AS totalSchools,
        (SELECT COUNT(*) FROM departments WHERE status = 'active') AS totalDepartments,
        (SELECT COUNT(*) FROM programs WHERE status = 'active') AS totalPrograms,
        (SELECT COUNT(*) FROM leave_applications) AS totalLeaves,
        (SELECT COUNT(*) FROM leave_applications WHERE status = 'pending') AS pendingLeaves,
        (SELECT COUNT(*) FROM leave_applications WHERE status = 'approved') AS approvedLeaves,
        (SELECT COUNT(*) FROM leave_applications WHERE status = 'rejected') AS rejectedLeaves,
        (SELECT ROUND(AVG(attendance_percentage), 2) FROM students WHERE account_status = 'active') AS averageAttendance,
        (SELECT COUNT(*) FROM students WHERE attendance_percentage < (SELECT MIN(minimum_attendance) FROM leave_policies WHERE status = 'active')) AS studentsAtRisk`
    );
    response.json({ stats });
  } catch (error) { next(error); }
});

app.get('/api/admin/catalog', authenticate, authorize('admin'), async (_request, response, next) => {
  try {
    const [schools, departments, programs, faculty, policies] = await Promise.all([
      pool.query('SELECT id, school_name AS name, school_code AS code FROM schools WHERE status = \'active\' ORDER BY school_name'),
      pool.query('SELECT id, school_id AS schoolId, department_name AS name, department_code AS code FROM departments WHERE status = \'active\' ORDER BY department_name'),
      pool.query('SELECT id, school_id AS schoolId, department_id AS departmentId, program_name AS name, program_code AS code FROM programs WHERE status = \'active\' ORDER BY program_name'),
      pool.query('SELECT id, name, faculty_id AS facultyId, department_id AS departmentId FROM faculty WHERE status = \'active\' ORDER BY name'),
      pool.query('SELECT id, leave_type AS leaveType, maximum_days AS maximumDays, minimum_attendance AS minimumAttendance, document_required AS documentRequired FROM leave_policies WHERE status = \'active\' ORDER BY leave_type')
    ]);
    response.json({ schools: schools[0], departments: departments[0], programs: programs[0], faculty: faculty[0], leavePolicies: policies[0] });
  } catch (error) { next(error); }
});

app.get('/api/admin/students', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(request.query.limit || 20)));
    const filters = []; const parameters = [];
    if (request.query.search) {
      const like = `%${String(request.query.search).trim()}%`;
      filters.push('(s.first_name LIKE ? OR s.last_name LIKE ? OR s.student_id LIKE ? OR s.enrollment_no LIKE ? OR s.email LIKE ?)'); parameters.push(like, like, like, like, like);
    }
    const optionalFilters = { schoolId: 's.school_id', departmentId: 's.department_id', programId: 's.program_id', semester: 's.semester', section: 's.section', facultyId: 's.faculty_id', status: 's.account_status' };
    for (const [queryKey, column] of Object.entries(optionalFilters)) {
      if (request.query[queryKey]) { filters.push(`${column} = ?`); parameters.push(request.query[queryKey]); }
    }
    const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
    const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM students s${where}`, parameters);
    const [items] = await pool.execute(`${studentSelect()}${where} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`, [...parameters, limit, (page - 1) * limit]);
    response.json({ items, pagination: { page, limit, total: count.total, totalPages: Math.ceil(count.total / limit) } });
  } catch (error) { next(error); }
});

app.get('/api/admin/students/:id', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const [students] = await pool.execute(`${studentSelect()} WHERE s.id = ?`, [request.params.id]);
    if (!students[0]) return response.status(404).json({ message: 'Student not found.' });
    const [leaves, attendance] = await Promise.all([
      pool.execute('SELECT id, leave_type AS leaveType, start_date AS startDate, end_date AS endDate, days, status, reason FROM leave_applications WHERE student_id = ? ORDER BY created_at DESC', [request.params.id]),
      pool.execute(`SELECT subject, ROUND(100 * SUM(status = 'present') / NULLIF(COUNT(*), 0), 2) AS percentage FROM attendance WHERE student_id = ? GROUP BY subject`, [request.params.id])
    ]);
    response.json({ student: students[0], leaves: leaves[0], attendance: attendance[0] });
  } catch (error) { next(error); }
});

app.post('/api/admin/students', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const values = getValidation(studentSchema, request.body);
    const student = await withTransaction(async (connection) => {
      await ensureAcademicRelationship(connection, values);
      const passwordHash = await bcrypt.hash(values.temporaryPassword, 12);
      let userId;
      try {
        const [user] = await connection.execute('INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, \'student\', TRUE)', [values.email.toLowerCase(), passwordHash]);
        userId = user.insertId;
        const [result] = await connection.execute(
          `INSERT INTO students (user_id, student_id, enrollment_no, first_name, last_name, email, phone, school_id, department_id, program_id, semester, section, academic_year, admission_year, faculty_id, attendance_percentage, total_leave_quota)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, values.studentId, values.enrollmentNo, values.firstName, values.lastName, values.email.toLowerCase(), values.phone || null,
            values.schoolId, values.departmentId, values.programId, values.semester, values.section, values.academicYear, values.admissionYear,
            values.facultyId || null, values.attendancePercentage, values.totalLeaveQuota]
        );
        await notify(connection, userId, 'Account created', 'Your university leave management account was created. Change your temporary password after signing in.');
        await audit(connection, request.user.id, 'student.created', 'student', result.insertId, { email: values.email.toLowerCase() });
        return result.insertId;
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Student ID, enrollment number, or email already exists.'), { status: 409 });
        throw error;
      }
    });
    response.status(201).json({ id: student, message: 'Student created successfully.' });
  } catch (error) { next(error); }
});

app.put('/api/admin/students/:id', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return response.status(422).json({ message: 'Invalid student ID.' });
    const updates = getValidation(studentUpdateSchema, request.body);
    if (!Object.keys(updates).length) return response.status(422).json({ message: 'Provide at least one field to update.' });
    await withTransaction(async (connection) => {
      const [[existing]] = await connection.execute('SELECT * FROM students WHERE id = ? FOR UPDATE', [id]);
      if (!existing) throw Object.assign(new Error('Student not found.'), { status: 404 });
      const combined = {
        ...updates,
        schoolId: updates.schoolId ?? existing.school_id, departmentId: updates.departmentId ?? existing.department_id,
        programId: updates.programId ?? existing.program_id, facultyId: updates.facultyId ?? existing.faculty_id
      };
      if (updates.schoolId || updates.departmentId || updates.programId || updates.facultyId !== undefined) await ensureAcademicRelationship(connection, combined);
      const columnMap = {
        studentId: 'student_id', enrollmentNo: 'enrollment_no', firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone',
        schoolId: 'school_id', departmentId: 'department_id', programId: 'program_id', semester: 'semester', section: 'section', academicYear: 'academic_year', admissionYear: 'admission_year', facultyId: 'faculty_id', attendancePercentage: 'attendance_percentage', totalLeaveQuota: 'total_leave_quota'
      };
      const entries = Object.entries(updates).filter(([key]) => columnMap[key]);
      const values = entries.map(([, value]) => value ?? null);
      try {
        await connection.execute(`UPDATE students SET ${entries.map(([key]) => `${columnMap[key]} = ?`).join(', ')} WHERE id = ?`, [...values, id]);
        if (updates.email) await connection.execute('UPDATE users SET email = ? WHERE id = ?', [updates.email.toLowerCase(), existing.user_id]);
        await audit(connection, request.user.id, 'student.updated', 'student', id, { fields: entries.map(([key]) => key) });
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Student ID, enrollment number, or email already exists.'), { status: 409 });
        throw error;
      }
    });
    response.json({ message: 'Student updated successfully.' });
  } catch (error) { next(error); }
});

app.patch('/api/admin/students/:id/status', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const { status } = getValidation(z.object({ status: z.enum(['active', 'inactive', 'blocked']) }), request.body);
    await withTransaction(async (connection) => {
      const [result] = await connection.execute('UPDATE students s JOIN users u ON u.id = s.user_id SET s.account_status = ?, u.status = ? WHERE s.id = ?', [status, status, request.params.id]);
      if (!result.affectedRows) throw Object.assign(new Error('Student not found.'), { status: 404 });
      await audit(connection, request.user.id, 'student.status_changed', 'student', request.params.id, { status });
    });
    response.json({ message: `Student account is now ${status}.` });
  } catch (error) { next(error); }
});

app.post('/api/admin/students/:id/reset-password', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const { temporaryPassword } = getValidation(z.object({ temporaryPassword: z.string().min(12).max(200) }), request.body);
    await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        'UPDATE users u JOIN students s ON s.user_id = u.id SET u.password_hash = ?, u.must_change_password = TRUE WHERE s.id = ?', [await bcrypt.hash(temporaryPassword, 12), request.params.id]
      );
      if (!result.affectedRows) throw Object.assign(new Error('Student not found.'), { status: 404 });
      await audit(connection, request.user.id, 'student.password_reset', 'student', request.params.id, { forcedChange: true });
    });
    response.json({ message: 'Student password reset successfully.' });
  } catch (error) { next(error); }
});

app.get('/api/admin/analytics/attendance-risk', authenticate, authorize('admin'), async (_request, response, next) => {
  try {
    const [items] = await pool.query(
      `SELECT s.id, CONCAT(s.first_name, ' ', s.last_name) AS studentName, s.student_id AS studentId, s.attendance_percentage AS attendancePercentage,
       CASE WHEN s.attendance_percentage < policy.minimumAttendance - 10 THEN 'high'
            WHEN s.attendance_percentage < policy.minimumAttendance THEN 'medium' ELSE 'low' END AS riskLevel
       FROM students s
       CROSS JOIN (SELECT COALESCE(MAX(minimum_attendance), 0) AS minimumAttendance FROM leave_policies WHERE status = 'active') policy
       WHERE s.account_status = 'active' ORDER BY s.attendance_percentage ASC LIMIT 100`
    );
    response.json({ items, note: 'Risk labels are predictions based on current attendance and must be reviewed by authorized staff.' });
  } catch (error) { next(error); }
});

app.post('/api/admin/assistant', authenticate, authorize('admin'), async (request, response, next) => {
  try {
    const { question } = getValidation(z.object({ question: z.string().trim().min(2).max(1000) }), request.body);
    const [[summary]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM leave_applications WHERE status = 'pending') AS pendingLeaves,
       (SELECT COUNT(*) FROM students WHERE attendance_percentage < 75 AND account_status = 'active') AS attendanceRiskStudents,
       (SELECT leave_type FROM leave_applications GROUP BY leave_type ORDER BY COUNT(*) DESC LIMIT 1) AS mostCommonLeaveType`
    );
    response.json({
      reply: `Controlled university data shows ${summary.pendingLeaves} pending leave applications, ${summary.attendanceRiskStudents} active students below 75% attendance, and ${summary.mostCommonLeaveType || 'no'} recorded most-common leave type. Your question was: ${question}. This assistant uses approved aggregate queries only and cannot execute arbitrary SQL.`,
      source: 'controlled-admin-analytics'
    });
  } catch (error) { next(error); }
});

function publicUser(user) {
  return {
    id: user.id, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password),
    name: user.first_name ? `${user.first_name} ${user.last_name}` : user.faculty_name || user.admin_name,
    studentId: user.student_id, facultyId: user.faculty_id
  };
}

app.use((request, response) => response.status(404).json({ message: `No route matches ${request.method} ${request.path}.` }));
app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) return response.status(422).json({ message: error.message });
  const status = error.status || (error.code === 'ER_DUP_ENTRY' ? 409 : 500);
  if (status >= 500) console.error(error);
  return response.status(status).json({ message: status >= 500 ? 'An unexpected server error occurred.' : error.message });
});

app.listen(port, () => console.log(`API listening on port ${port}`));
