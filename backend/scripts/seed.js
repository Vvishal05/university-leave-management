import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db.js';

const required = ['SEED_ADMIN_PASSWORD', 'SEED_FACULTY_PASSWORD', 'SEED_STUDENT_PASSWORD', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_NAME', 'SEED_FACULTY_EMAIL', 'SEED_FACULTY_ID', 'SEED_FACULTY_NAME', 'SEED_STUDENT_EMAIL', 'SEED_EMAIL_DOMAIN'];
const missing = required.filter((key) => !process.env[key] || process.env[key].startsWith('CHANGE_ME'));
if (missing.length) throw new Error(`Set non-placeholder seed variables before seeding: ${missing.join(', ')}`);

const schools = [
  ['School of Computer Science & Engineering', 'CSE', 'Computer Science', 'CS', 'B.Tech CSE', 'BTCSE'],
  ['School of Management', 'MGT', 'Management Studies', 'MGMT', 'MBA', 'MBA'],
  ['School of Engineering', 'ENG', 'Mechanical Engineering', 'ME', 'B.Tech Mechanical Engineering', 'BTME'],
  ['School of Basic Sciences', 'SCI', 'Mathematics', 'MATH', 'B.Sc Mathematics', 'BSCM'],
  ['School of Pharmacy', 'PHA', 'Pharmacy', 'PHARM', 'B.Pharm', 'BPH'],
  ['School of Commerce', 'COM', 'Commerce', 'COMM', 'B.Com', 'BCOM'],
  ['School of Law', 'LAW', 'Law', 'LAW', 'B.A. LL.B', 'BALLB'],
  ['School of Agriculture', 'AGR', 'Agriculture', 'AGRI', 'B.Sc Agriculture', 'BAG'],
  ['School of Hotel & Hospitality Management', 'HOS', 'Hospitality', 'HOSP', 'BHM', 'BHM']
];
const firstNames = ['Aarav', 'Aditi', 'Akash', 'Ananya', 'Arjun', 'Bhavna', 'Dev', 'Diya', 'Ishaan', 'Kavya', 'Maya', 'Neel', 'Nisha', 'Priya', 'Rahul', 'Riya', 'Rohan', 'Saanvi', 'Tanvi', 'Vihaan'];
const lastNames = ['Agarwal', 'Bose', 'Chopra', 'Das', 'Gupta', 'Iyer', 'Jain', 'Kapoor', 'Khan', 'Mehta', 'Nair', 'Patel', 'Reddy', 'Shah', 'Singh'];

async function ensureUser(connection, { email, password, role, mustChangePassword = false }) {
  const [existing] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return existing[0].id;
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await connection.execute(
    'INSERT INTO users (email, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)',
    [email, passwordHash, role, mustChangePassword]
  );
  return result.insertId;
}

async function getOrCreateAcademicData(connection) {
  const records = [];
  for (const [schoolName, schoolCode, departmentName, departmentCode, programName, programCode] of schools) {
    await connection.execute(
      'INSERT IGNORE INTO schools (school_name, school_code) VALUES (?, ?)',
      [schoolName, schoolCode]
    );
    const [[school]] = await connection.execute('SELECT id FROM schools WHERE school_code = ?', [schoolCode]);
    await connection.execute(
      'INSERT IGNORE INTO departments (school_id, department_name, department_code) VALUES (?, ?, ?)',
      [school.id, departmentName, departmentCode]
    );
    const [[department]] = await connection.execute('SELECT id FROM departments WHERE department_code = ?', [departmentCode]);
    await connection.execute(
      'INSERT IGNORE INTO programs (school_id, department_id, program_name, program_code, duration_years) VALUES (?, ?, ?, ?, ?)',
      [school.id, department.id, programName, programCode, programName.includes('MBA') ? 2 : 4]
    );
    const [[program]] = await connection.execute('SELECT id FROM programs WHERE program_code = ?', [programCode]);
    records.push({ school, department, program });
  }
  return records;
}

async function run() {
  await withTransaction(async (connection) => {
    const adminUserId = await ensureUser(connection, {
      email: process.env.SEED_ADMIN_EMAIL, password: process.env.admin123, role: 'admin'
    });
    await connection.execute('INSERT IGNORE INTO admins (user_id, name, email) VALUES (?, ?, ?)', [adminUserId, process.env.SEED_ADMIN_NAME, process.env.SEED_ADMIN_EMAIL]);

    const academicData = await getOrCreateAcademicData(connection);
    const facultyUserId = await ensureUser(connection, {
      email: process.env.SEED_FACULTY_EMAIL, password: process.env.faculty123, role: 'faculty'
    });
    await connection.execute(
      'INSERT IGNORE INTO faculty (user_id, faculty_id, name, email, department_id, designation) VALUES (?, ?, ?, ?, ?, ?)',
      [facultyUserId, process.env.SEED_FACULTY_ID, process.env.SEED_FACULTY_NAME, process.env.SEED_FACULTY_EMAIL, academicData[0].department.id, 'Assistant Professor']
    );
    const [[faculty]] = await connection.execute('SELECT id FROM faculty WHERE user_id = ?', [facultyUserId]);

    for (let index = 1; index <= 110; index += 1) {
      const academic = academicData[(index - 1) % academicData.length];
      const firstName = firstNames[(index - 1) % firstNames.length];
      const lastName = lastNames[(index * 3) % lastNames.length];
      const studentCode = `STU${String(1000 + index)}`;
      const email = index === 1 ? process.env.SEED_STUDENT_EMAIL : `student${1000 + index}@${process.env.SEED_EMAIL_DOMAIN}`;
      const userId = await ensureUser(connection, {
        email, password: process.env.student123, role: 'student', mustChangePassword: false
      });
      await connection.execute(
        `INSERT IGNORE INTO students
          (user_id, student_id, enrollment_no, first_name, last_name, email, school_id, department_id, program_id, semester, section, academic_year, admission_year, faculty_id, attendance_percentage, total_leave_quota, used_leave)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, studentCode, `ENR${new Date().getFullYear()}${String(index).padStart(4, '0')}`, firstName, lastName, email,
          academic.school.id, academic.department.id, academic.program.id, (index % 8) + 1, String.fromCharCode(65 + (index % 3)),
          `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`, new Date().getFullYear() - ((index % 4) + 1), faculty.id,
          68 + (index % 30), 20, index % 6]
      );
    }
  });
  console.log('Seed complete: 1 admin, 1 faculty, and 110 students.');
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
