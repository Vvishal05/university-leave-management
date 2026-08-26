import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { Activity, Bell, BookOpenCheck, CalendarDays, CheckCircle2, ChevronRight, ClipboardList, GraduationCap, LayoutDashboard, LogOut, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { api } from './api.js';

const portalCopy = {
  student: { title: 'Student portal', detail: 'Apply for leave, check balances, attendance, and request status.', icon: GraduationCap },
  faculty: { title: 'Faculty portal', detail: 'Review requests only from your assigned students.', icon: BookOpenCheck },
  admin: { title: 'Administration', detail: 'Manage university records, workflow, and live analytics.', icon: ShieldCheck }
};

function useRemote(load, dependencies = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const reload = async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { setState({ loading: false, data: await load(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error.message }); }
  };
  useEffect(() => { reload(); }, dependencies); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload };
}

function App() {
  const [session, setSession] = useState(null);
  return <Routes>
    <Route path="/" element={<Login onLogin={setSession} />} />
    <Route path="/:role/dashboard" element={<Portal session={session} onLogout={() => setSession(null)} />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

function Login({ onLogin }) {
  const navigate = useNavigate();
  const [portal, setPortal] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const selected = portalCopy[portal];
  const Icon = selected.icon;

  async function submit(event) {
    event.preventDefault(); setSubmitting(true); setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: { email, password, portal } });
      onLogin(result); navigate(`/${result.user.role}/dashboard`, { replace: true });
    } catch (requestError) { setError(requestError.message); }
    finally { setSubmitting(false); }
  }

  return <main className="login-shell">
    <section className="login-intro">
      <div className="brand"><CalendarDays size={30} /> <span>University Leave</span></div>
      <div>
        <p className="eyebrow">UNIVERSITY OPERATIONS</p>
        <h1>Leave decisions, made accountable.</h1>
        <p className="lede">One secure workflow for students, faculty, and university administrators.</p>
      </div>
      <div className="feature-list">
        <span><CheckCircle2 /> Database-backed applications</span>
        <span><CheckCircle2 /> Role-based access</span>
        <span><CheckCircle2 /> Live attendance insight</span>
      </div>
    </section>
    <section className="login-panel" aria-label="Sign in">
      <Icon className="portal-icon" size={28} />
      <h2>{selected.title}</h2><p>{selected.detail}</p>
      <div className="portal-tabs" role="tablist">
        {Object.entries(portalCopy).map(([key, copy]) => <button key={key} className={portal === key ? 'active' : ''} onClick={() => setPortal(key)} type="button">{copy.title.replace(' portal', '')}</button>)}
      </div>
      <form onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ChevronRight size={18} /></button>
      </form>
    </section>
  </main>;
}

function Portal({ session, onLogout }) {
  const { role } = useParams();
  if (!session || session.user.role !== role) return <Navigate to="/" replace />;
  return <AuthenticatedPortal session={session} onLogout={onLogout} role={role} />;
}

function AuthenticatedPortal({ session, onLogout, role }) {
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notifications = useRemote(() => api('/notifications', { token: session.token }), [session.token]);
  const roleName = role[0].toUpperCase() + role.slice(1);
  const menu = role === 'student' ? ['Overview', 'My leaves', 'Apply leave', 'Attendance', 'Leave assistant'] : role === 'faculty' ? ['Overview', 'Leave requests'] : ['Overview', 'Students', 'Attendance risk', 'University assistant'];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><CalendarDays /> <span>University Leave</span></div>
      <div className="role-chip">{roleName} access</div>
      <nav>{menu.map((item, index) => <a className={index === 0 ? 'selected' : ''} href={`#${item.toLowerCase().replaceAll(' ', '-')}`} key={item}>{index === 0 ? <LayoutDashboard /> : <ClipboardList />}{item}</a>)}</nav>
      <button className="logout" onClick={() => { onLogout(); navigate('/'); }}><LogOut /> Sign out</button>
    </aside>
    <main className="workspace">
      <header className="topbar"><div><p className="eyebrow">{roleName} PORTAL</p><h1>Welcome, {session.user.name || roleName}</h1></div>
        <div className="notification-wrap"><button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}><Bell />{notifications.data?.items?.some((item) => !item.readStatus) && <i />}</button>
        {notificationsOpen && <div className="notifications">{notifications.loading ? 'Loading…' : notifications.data?.items?.length ? notifications.data.items.slice(0, 5).map((item) => <div key={item.id}><strong>{item.title}</strong><span>{item.message}</span></div>) : 'No notifications yet.'}</div>}</div>
      </header>
      {notice && <div className="toast"><CheckCircle2 /> {notice}<button onClick={() => setNotice('')}>×</button></div>}
      {role === 'student' && <StudentPortal token={session.token} setNotice={setNotice} />}
      {role === 'faculty' && <FacultyPortal token={session.token} setNotice={setNotice} />}
      {role === 'admin' && <AdminPortal token={session.token} setNotice={setNotice} />}
    </main>
  </div>;
}

function StudentPortal({ token, setNotice }) {
  const dashboard = useRemote(() => api('/student/dashboard', { token }), [token]);
  const leaves = useRemote(() => api('/student/leaves', { token }), [token]);
  const attendance = useRemote(() => api('/student/attendance', { token }), [token]);
  const policies = useRemote(() => api('/student/leave-policies', { token }), [token]);
  const [formOpen, setFormOpen] = useState(false);
  const profile = dashboard.data?.profile;
  return <>
    {dashboard.error && <ErrorState error={dashboard.error} retry={dashboard.reload} />}
    {dashboard.loading ? <Loading /> : profile && <>
      <section className="hero-card"><div><p className="eyebrow">STUDENT SUMMARY</p><h2>{profile.firstName} {profile.lastName}</h2><p>{profile.enrollmentNo} · {profile.programName} · Semester {profile.semester}</p></div><button className="button primary" onClick={() => setFormOpen(true)}><Plus size={18} /> Apply for leave</button></section>
      <section className="stats-grid">
        <Stat label="Attendance" value={`${profile.attendancePercentage}%`} icon={<Activity />} />
        <Stat label="Leave remaining" value={`${profile.remainingLeave} days`} icon={<CalendarDays />} />
        <Stat label="Pending" value={dashboard.data.leaveCounts.pending || 0} icon={<ClipboardList />} />
        <Stat label="Approved" value={dashboard.data.leaveCounts.approved || 0} icon={<CheckCircle2 />} />
      </section>
    </>}
    <section className="content-grid two"><Panel title="Recent leave applications" action={<button className="text-button" onClick={leaves.reload}><RefreshCw size={15} /> Refresh</button>}><LeaveTable loading={leaves.loading} leaves={leaves.data?.items} error={leaves.error} /></Panel>
      <Panel title="Attendance by subject"><AttendanceTable loading={attendance.loading} items={attendance.data?.items} /></Panel></section>
    {formOpen && <LeaveForm token={token} policies={policies.data?.items || []} onClose={() => setFormOpen(false)} onSuccess={() => { leaves.reload(); dashboard.reload(); setNotice('Leave application submitted for review.'); }} />}
  </>;
}

function FacultyPortal({ token, setNotice }) {
  const dashboard = useRemote(() => api('/faculty/dashboard', { token }), [token]);
  const leaves = useRemote(() => api('/faculty/leaves', { token }), [token]);
  async function action(id, action) {
    const remarks = action === 'rejected' ? window.prompt('Enter a rejection reason:') : window.prompt('Optional remarks:');
    if (action === 'rejected' && !remarks) return;
    try { await api(`/faculty/leaves/${id}/action`, { token, method: 'POST', body: { action, remarks } }); leaves.reload(); dashboard.reload(); setNotice(`Leave request ${action.replace('_', ' ')}.`); }
    catch (error) { setNotice(error.message); }
  }
  const metrics = dashboard.data?.metrics;
  return <>
    {dashboard.loading ? <Loading /> : dashboard.error ? <ErrorState error={dashboard.error} retry={dashboard.reload} /> : <>
      <section className="stats-grid"><Stat label="Assigned students" value={metrics?.assignedStudents || 0} icon={<Users />} /><Stat label="Pending review" value={metrics?.pendingLeaves || 0} icon={<ClipboardList />} /><Stat label="Approved" value={metrics?.approvedLeaves || 0} icon={<CheckCircle2 />} /><Stat label="Average attendance" value={`${metrics?.averageAttendance || 0}%`} icon={<Activity />} /></section>
      <Panel title="Assigned student leave requests"><FacultyLeaveTable loading={leaves.loading} leaves={leaves.data?.items} onAction={action} /></Panel>
    </>}
  </>;
}

function AdminPortal({ token, setNotice }) {
  const dashboard = useRemote(() => api('/admin/dashboard', { token }), [token]);
  const catalog = useRemote(() => api('/admin/catalog', { token }), [token]);
  const [search, setSearch] = useState('');
  const students = useRemote(() => api(`/admin/students?limit=20&search=${encodeURIComponent(search)}`, { token }), [token, search]);
  const risks = useRemote(() => api('/admin/analytics/attendance-risk', { token }), [token]);
  const [studentFormOpen, setStudentFormOpen] = useState(false);
  const stats = dashboard.data?.stats;
  return <>
    {dashboard.loading ? <Loading /> : dashboard.error ? <ErrorState error={dashboard.error} retry={dashboard.reload} /> : <>
      <section className="stats-grid"><Stat label="Total students" value={stats.totalStudents} icon={<Users />} /><Stat label="Pending leaves" value={stats.pendingLeaves} icon={<ClipboardList />} /><Stat label="Average attendance" value={`${stats.averageAttendance || 0}%`} icon={<Activity />} /><Stat label="Students at risk" value={stats.studentsAtRisk} icon={<ShieldCheck />} /></section>
      <Panel title="Student management" action={<button className="button primary" onClick={() => setStudentFormOpen(true)}><Plus size={17} /> Add student</button>}>
        <div className="table-tools"><input aria-label="Search students" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, enrollment, or email" /><span>{students.data?.pagination?.total || 0} records</span></div>
        <StudentTable loading={students.loading} items={students.data?.items} error={students.error} token={token} onChanged={() => { students.reload(); dashboard.reload(); }} setNotice={setNotice} />
      </Panel>
      <section className="content-grid two"><Panel title="Attendance risk prediction"><RiskTable loading={risks.loading} items={risks.data?.items} /></Panel><UniversityAssistant token={token} /></section>
    </>}
    {studentFormOpen && <StudentForm catalog={catalog.data} loadingCatalog={catalog.loading} token={token} onClose={() => setStudentFormOpen(false)} onSuccess={() => { students.reload(); dashboard.reload(); setNotice('Student created successfully.'); }} />}
  </>;
}

function Stat({ label, value, icon }) { return <article className="stat-card"><div><p>{label}</p><strong>{value ?? '—'}</strong></div><span>{icon}</span></article>; }
function Panel({ title, action, children }) { return <section className="panel"><div className="panel-header"><h2>{title}</h2>{action}</div>{children}</section>; }
function Loading() { return <div className="loading"><RefreshCw className="spin" /> Loading live data…</div>; }
function ErrorState({ error, retry }) { return <div className="empty error-state"><strong>Couldn’t load this data.</strong><p>{error}</p><button className="button secondary" onClick={retry}>Try again</button></div>; }

function LeaveTable({ loading, leaves, error }) { if (loading) return <Loading />; if (error) return <p className="error">{error}</p>; if (!leaves?.length) return <div className="empty">No leave applications yet.</div>; return <div className="table-wrap"><table><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th></tr></thead><tbody>{leaves.map((leave) => <tr key={leave.id}><td>{leave.leaveType}</td><td>{leave.startDate} — {leave.endDate}</td><td>{leave.days}</td><td><Status value={leave.status} /></td></tr>)}</tbody></table></div>; }
function AttendanceTable({ loading, items }) { if (loading) return <Loading />; if (!items?.length) return <div className="empty">No subject attendance records yet.</div>; return <div className="table-wrap"><table><thead><tr><th>Subject</th><th>Present</th><th>Absent</th><th>Attendance</th></tr></thead><tbody>{items.map((item) => <tr key={item.subject}><td>{item.subject}</td><td>{item.present}</td><td>{item.absent}</td><td>{item.percentage ?? '—'}%</td></tr>)}</tbody></table></div>; }
function Status({ value }) { return <span className={`status ${value}`}>{value?.replaceAll('_', ' ')}</span>; }

function FacultyLeaveTable({ loading, leaves, onAction }) { if (loading) return <Loading />; if (!leaves?.length) return <div className="empty">No assigned leave requests.</div>; return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Request</th><th>Attendance</th><th>Status</th><th>Action</th></tr></thead><tbody>{leaves.map((leave) => <tr key={leave.id}><td><strong>{leave.studentName}</strong><br /><small>{leave.enrollmentNo}</small></td><td>{leave.leaveType}<br /><small>{leave.startDate} — {leave.endDate} · {leave.days} days</small></td><td>{leave.attendancePercentage}%</td><td><Status value={leave.status} /></td><td>{['pending', 'under_review', 'clarification_requested'].includes(leave.status) && <div className="actions"><button onClick={() => onAction(leave.id, 'approved')}>Approve</button><button onClick={() => onAction(leave.id, 'clarification_requested')}>Clarify</button><button className="danger-text" onClick={() => onAction(leave.id, 'rejected')}>Reject</button></div>}</td></tr>)}</tbody></table></div>; }

function StudentTable({ loading, items, error, token, onChanged, setNotice }) {
  async function updateStatus(id, status) { try { await api(`/admin/students/${id}/status`, { token, method: 'PATCH', body: { status } }); onChanged(); setNotice(`Student account set to ${status}.`); } catch (requestError) { setNotice(requestError.message); } }
  if (loading) return <Loading />; if (error) return <p className="error">{error}</p>; if (!items?.length) return <div className="empty">No students match these filters.</div>;
  return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Academic record</th><th>Attendance</th><th>Leave balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{items.map((student) => <tr key={student.id}><td><strong>{student.firstName} {student.lastName}</strong><br /><small>{student.studentId} · {student.enrollmentNo}</small></td><td>{student.programName}<br /><small>Sem {student.semester} · {student.section}</small></td><td>{student.attendancePercentage}%</td><td>{student.remainingLeave} days</td><td><Status value={student.accountStatus} /></td><td><div className="actions">{student.accountStatus === 'blocked' ? <button onClick={() => updateStatus(student.id, 'active')}>Unblock</button> : <button onClick={() => updateStatus(student.id, 'blocked')}>Block</button>}<button className="danger-text" onClick={() => updateStatus(student.id, 'inactive')}>Deactivate</button></div></td></tr>)}</tbody></table></div>;
}

function RiskTable({ loading, items }) { if (loading) return <Loading />; if (!items?.length) return <div className="empty">No active student records.</div>; return <div className="table-wrap"><table><thead><tr><th>Student</th><th>Attendance</th><th>Risk</th></tr></thead><tbody>{items.slice(0, 8).map((item) => <tr key={item.id}><td>{item.studentName}</td><td>{item.attendancePercentage}%</td><td><Status value={item.riskLevel} /></td></tr>)}</tbody></table></div>; }

function LeaveForm({ token, policies, onClose, onSuccess }) {
  const [values, setValues] = useState({ leaveType: '', startDate: '', endDate: '', reason: '', emergency: false, contactInformation: '' });
  const [file, setFile] = useState(null); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  function change(event) { const { name, value, type, checked } = event.target; setValues((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value })); }
  async function submit(event) { event.preventDefault(); setSaving(true); setError(''); try { const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.append(key, value)); if (file) data.append('document', file); await api('/student/leaves', { token, method: 'POST', formData: data }); onSuccess(); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSaving(false); } }
  return <Modal title="Apply for leave" onClose={onClose}><form className="form-grid" onSubmit={submit}><label>Leave type<select name="leaveType" value={values.leaveType} onChange={change} required><option value="">Select leave type</option>{policies.map((policy) => <option value={policy.leaveType} key={policy.id}>{policy.leaveType} · {policy.maximumDays} days maximum</option>)}</select></label><label>Start date<input name="startDate" type="date" value={values.startDate} onChange={change} required /></label><label>End date<input name="endDate" type="date" value={values.endDate} onChange={change} required /></label><label>Contact information<input name="contactInformation" value={values.contactInformation} onChange={change} maxLength="255" /></label><label className="wide">Reason<textarea name="reason" value={values.reason} onChange={change} minLength="10" required /></label><label>Supporting document<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><label className="check"><input type="checkbox" name="emergency" checked={values.emergency} onChange={change} /> Emergency leave</label>{error && <p className="error wide">{error}</p>}<div className="modal-actions wide"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !policies.length}>{saving ? 'Submitting…' : 'Submit application'}</button></div></form></Modal>;
}

function StudentForm({ catalog, loadingCatalog, token, onClose, onSuccess }) {
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const initial = useMemo(() => ({ studentId: '', enrollmentNo: '', firstName: '', lastName: '', email: '', temporaryPassword: '', schoolId: '', departmentId: '', programId: '', semester: 1, section: 'A', academicYear: '', admissionYear: new Date().getFullYear(), attendancePercentage: 100, totalLeaveQuota: 20 }), []);
  const [values, setValues] = useState(initial);
  const departments = catalog?.departments?.filter((item) => String(item.schoolId) === String(values.schoolId)) || [];
  const programs = catalog?.programs?.filter((item) => String(item.departmentId) === String(values.departmentId)) || [];
  function change(event) { const { name, value } = event.target; setValues((current) => ({ ...current, [name]: value })); }
  async function submit(event) { event.preventDefault(); setSaving(true); setError(''); try { await api('/admin/students', { token, method: 'POST', body: values }); onSuccess(); onClose(); } catch (requestError) { setError(requestError.message); } finally { setSaving(false); } }
  return <Modal title="Add student" onClose={onClose}>{loadingCatalog ? <Loading /> : <form className="form-grid" onSubmit={submit}><label>Student ID<input name="studentId" value={values.studentId} onChange={change} required /></label><label>Enrollment number<input name="enrollmentNo" value={values.enrollmentNo} onChange={change} required /></label><label>First name<input name="firstName" value={values.firstName} onChange={change} required /></label><label>Last name<input name="lastName" value={values.lastName} onChange={change} required /></label><label>Email<input name="email" type="email" value={values.email} onChange={change} required /></label><label>Temporary password<input name="temporaryPassword" type="password" minLength="12" value={values.temporaryPassword} onChange={change} required /></label><label>School<select name="schoolId" value={values.schoolId} onChange={change} required><option value="">Select school</option>{catalog?.schools?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Department<select name="departmentId" value={values.departmentId} onChange={change} required><option value="">Select department</option>{departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Program<select name="programId" value={values.programId} onChange={change} required><option value="">Select program</option>{programs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Faculty<select name="facultyId" value={values.facultyId || ''} onChange={change}><option value="">Unassigned</option>{catalog?.faculty?.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Semester<input name="semester" type="number" min="1" max="16" value={values.semester} onChange={change} required /></label><label>Section<input name="section" value={values.section} onChange={change} required /></label><label>Academic year<input name="academicYear" placeholder="2026-2027" value={values.academicYear} onChange={change} required /></label><label>Admission year<input name="admissionYear" type="number" value={values.admissionYear} onChange={change} required /></label>{error && <p className="error wide">{error}</p>}<div className="modal-actions wide"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save student'}</button></div></form>}</Modal>;
}

function UniversityAssistant({ token }) { const [question, setQuestion] = useState(''); const [reply, setReply] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false); async function ask(event) { event.preventDefault(); setLoading(true); setError(''); try { const result = await api('/admin/assistant', { token, method: 'POST', body: { question } }); setReply(result.reply); } catch (requestError) { setError(requestError.message); } finally { setLoading(false); } } return <Panel title="University assistant"><p className="muted">Uses only approved aggregate queries. It cannot run arbitrary SQL or take approval actions.</p><form className="assistant-form" onSubmit={ask}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about pending leave activity" minLength="2" required /><button className="button primary" disabled={loading}>{loading ? 'Thinking…' : 'Ask'}</button></form>{error && <p className="error">{error}</p>}{reply && <p className="assistant-reply">{reply}</p>}</Panel>; }
function Modal({ title, onClose, children }) { return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="panel-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>{children}</section></div>; }

export default App;
