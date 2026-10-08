-- Run once in MySQL Workbench, connected as root.
-- Replace CHANGE_ME with a password of your own, and use the same value in backend/.env.
CREATE DATABASE IF NOT EXISTS aegis CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'aegis'@'localhost' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON aegis.* TO 'aegis'@'localhost';
FLUSH PRIVILEGES;
