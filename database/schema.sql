-- =========================================================
-- SYNQORA MASTER DATABASE SCHEMA (MySQL)
-- =========================================================
CREATE DATABASE IF NOT EXISTS synqora_pro;
USE synqora_pro;

-- 1. USERS TABLE (Includes role column for user/admin)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    university VARCHAR(150) DEFAULT 'Mumbai University Roster',
    role ENUM('user', 'admin') DEFAULT 'user',
    github_url VARCHAR(255) DEFAULT NULL,
    linkedin_url VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. SKILLS TABLE
CREATE TABLE IF NOT EXISTS skills (
    id INT AUTO_INCREMENT PRIMARY KEY,
    skill_name VARCHAR(100) NOT NULL UNIQUE,
    category VARCHAR(50) DEFAULT 'Computer Science',
    total_questions INT DEFAULT 10,
    passing_score DECIMAL(5,2) DEFAULT 80.00
);

-- 3. USER ASSESSMENTS (PASSPORT / CERTIFICATE DATA)
CREATE TABLE IF NOT EXISTS user_assessments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    skill_id INT NOT NULL,
    score_percentage DECIMAL(5,2) NOT NULL,
    grade VARCHAR(10) NOT NULL,
    roster_rank VARCHAR(20) DEFAULT 'Top 2.5%',
    proctoring_status VARCHAR(50) DEFAULT '100% Clean',
    hash_key VARCHAR(100) NOT NULL UNIQUE,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

-- 4. PROCTOR LOGS (ANTI-CHEATING SECURITY LOGS)
CREATE TABLE IF NOT EXISTS proctor_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    assessment_id INT NOT NULL,
    violation_type VARCHAR(100) NOT NULL,
    warning_count INT DEFAULT 1,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assessment_id) REFERENCES user_assessments(id) ON DELETE CASCADE
);

-- 5. PROJECT REQUESTS (TEAMMATE INVITES & ROSTER CONNECTIONS)
CREATE TABLE IF NOT EXISTS project_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    project_title VARCHAR(150) NOT NULL,
    status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. CHAT MESSAGES (SYNCSPACE REALTIME WORKSPACE CHAT)
CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    receiver_id INT NOT NULL,
    message TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 7. ADMIN ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT DEFAULT NULL,
    action_type VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 8. INITIAL SEED DATA
INSERT IGNORE INTO skills (id, skill_name, category) VALUES 
(1, 'Python', 'Backend & APIs'),
(2, 'MySQL', 'Databases'),
(3, 'Data Structures', 'Core CS'),
(4, 'FastAPI', 'Backend & APIs');

-- Password for Abhishek Tiwari & Admin below is 'password123' (bcrypt hashed)
INSERT IGNORE INTO users (id, full_name, email, password_hash, university, role) VALUES 
(1, 'Abhishek Tiwari', 'abhishek@synqora.io', '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW', 'Mumbai University Roster', 'admin'),
(2, 'Rahul Sharma', 'rahul@synqora.io', '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW', 'IIT Bombay', 'user'),
(3, 'Sneha Patel', 'sneha@synqora.io', '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW', 'VJTI Mumbai', 'user');

INSERT IGNORE INTO user_assessments (id, user_id, skill_id, score_percentage, grade, roster_rank, proctoring_status, hash_key) VALUES 
(1, 1, 1, 86.00, 'Grade A+', 'Top 2.5%', '100% Clean', 'SYNQ-0x8F2A9C4E7B'),
(2, 2, 2, 90.00, 'Grade O', 'Top 1.0%', '100% Clean', 'SYNQ-0x4C1D7E9A2F');

INSERT IGNORE INTO project_requests (id, sender_id, receiver_id, project_title, status) VALUES
(1, 2, 1, 'Synqora Platform', 'pending');
