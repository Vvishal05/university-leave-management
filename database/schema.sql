CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('student', 'faculty', 'admin') NOT NULL,
  status ENUM('active', 'inactive', 'blocked') NOT NULL DEFAULT 'active',
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_status (role, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schools (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_name VARCHAR(255) NOT NULL UNIQUE,
  school_code VARCHAR(32) NOT NULL UNIQUE,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  department_name VARCHAR(255) NOT NULL,
  department_code VARCHAR(32) NOT NULL UNIQUE,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_departments_school FOREIGN KEY (school_id) REFERENCES schools(id),
  UNIQUE KEY uq_departments_school_name (school_id, department_name),
  INDEX idx_departments_school (school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS programs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  program_name VARCHAR(255) NOT NULL,
  program_code VARCHAR(32) NOT NULL UNIQUE,
  duration_years TINYINT UNSIGNED NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_programs_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_programs_department FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_programs_department (department_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS faculty (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  faculty_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  department_id BIGINT UNSIGNED,
  designation VARCHAR(100),
  joining_date DATE,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_faculty_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_faculty_department FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_faculty_department (department_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admins (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admins_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  student_id VARCHAR(64) NOT NULL UNIQUE,
  enrollment_no VARCHAR(64) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  date_of_birth DATE,
  gender ENUM('female', 'male', 'non_binary', 'prefer_not_to_say'),
  photo VARCHAR(512),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  school_id BIGINT UNSIGNED NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  program_id BIGINT UNSIGNED NOT NULL,
  semester TINYINT UNSIGNED NOT NULL,
  section VARCHAR(16) NOT NULL,
  academic_year VARCHAR(32) NOT NULL,
  admission_year SMALLINT UNSIGNED NOT NULL,
  faculty_id BIGINT UNSIGNED,
  attendance_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  total_leave_quota DECIMAL(5,1) NOT NULL DEFAULT 20.0,
  used_leave DECIMAL(5,1) NOT NULL DEFAULT 0.0,
  remaining_leave DECIMAL(5,1) AS (total_leave_quota - used_leave) STORED,
  account_status ENUM('active', 'inactive', 'blocked') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_students_school FOREIGN KEY (school_id) REFERENCES schools(id),
  CONSTRAINT fk_students_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_students_program FOREIGN KEY (program_id) REFERENCES programs(id),
  CONSTRAINT fk_students_faculty FOREIGN KEY (faculty_id) REFERENCES faculty(id),
  INDEX idx_students_academic (school_id, department_id, program_id, semester, section),
  INDEX idx_students_faculty (faculty_id),
  INDEX idx_students_status (account_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leave_policies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  leave_type VARCHAR(64) NOT NULL UNIQUE,
  maximum_days DECIMAL(5,1) NOT NULL,
  minimum_attendance DECIMAL(5,2) NOT NULL DEFAULT 0,
  document_required BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leave_applications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  leave_type VARCHAR(64) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(5,1) NOT NULL,
  reason TEXT NOT NULL,
  document VARCHAR(512),
  emergency BOOLEAN NOT NULL DEFAULT FALSE,
  contact_information VARCHAR(255),
  status ENUM('pending', 'under_review', 'clarification_requested', 'approved', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leave_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date),
  INDEX idx_leaves_student_status (student_id, status),
  INDEX idx_leaves_dates (start_date, end_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leave_approvals (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  leave_id BIGINT UNSIGNED NOT NULL,
  approver_id BIGINT UNSIGNED NOT NULL,
  action ENUM('approved', 'rejected', 'clarification_requested') NOT NULL,
  remarks TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_approvals_leave FOREIGN KEY (leave_id) REFERENCES leave_applications(id),
  CONSTRAINT fk_approvals_user FOREIGN KEY (approver_id) REFERENCES users(id),
  INDEX idx_approvals_leave (leave_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(255) NOT NULL,
  attendance_date DATE NOT NULL,
  status ENUM('present', 'absent', 'leave') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id),
  UNIQUE KEY uq_attendance_student_subject_date (student_id, subject, attendance_date),
  INDEX idx_attendance_student_date (student_id, attendance_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  read_status BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_notifications_user_read (user_id, read_status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT UNSIGNED,
  details JSON,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  INDEX idx_audit_actor_created (actor_user_id, created_at),
  INDEX idx_audit_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics_predictions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED,
  prediction_type VARCHAR(64) NOT NULL,
  risk_level ENUM('low', 'medium', 'high') NOT NULL,
  prediction JSON NOT NULL,
  confidence DECIMAL(5,2),
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_predictions_student FOREIGN KEY (student_id) REFERENCES students(id),
  INDEX idx_predictions_type_risk (prediction_type, risk_level)
) ENGINE=InnoDB;

INSERT IGNORE INTO leave_policies (leave_type, maximum_days, minimum_attendance, document_required) VALUES
  ('Casual', 7, 75, FALSE),
  ('Medical', 10, 60, TRUE),
  ('Emergency', 5, 0, FALSE),
  ('Academic', 3, 75, FALSE);
