-- Create database if not exists (Note: User might need root privileges for this)
CREATE DATABASE IF NOT EXISTS xeno_crm;
USE xeno_crm;

-- Drop tables if they exist to start clean during setup
DROP TABLE IF EXISTS campaign_analytics;
DROP TABLE IF EXISTS campaign_logs;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS segments;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;

-- Table: customers
CREATE TABLE customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(30) NULL,
    location VARCHAR(150) NULL,
    attributes JSON NULL, -- JSON block for dynamic custom attributes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_customers_email (email),
    INDEX idx_customers_location (location)
);

-- Table: orders
CREATE TABLE orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    order_number VARCHAR(100) UNIQUE NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    order_date DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX idx_orders_customer_id (customer_id),
    INDEX idx_orders_order_date (order_date)
);

-- Table: segments
CREATE TABLE segments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    rules JSON NOT NULL, -- Logical filters JSON array
    sql_query TEXT NOT NULL, -- Dynamic executable SQL built by UI or AI
    sql_params JSON NULL, -- Array of parameters to apply to sql_query
    query_type ENUM('manual', 'ai') DEFAULT 'manual',
    raw_prompt TEXT NULL, -- Original AI prompt if dynamic segment
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Table: campaigns
CREATE TABLE campaigns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    segment_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    subject_line VARCHAR(255) NOT NULL,
    message_template TEXT NOT NULL, -- Content template with dynamic handlebar tokens
    ai_prompt TEXT NULL,
    status ENUM('draft', 'sending', 'completed') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE RESTRICT
);

-- Table: campaign_logs
CREATE TABLE campaign_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    customer_id INT NOT NULL,
    message_body TEXT NOT NULL, -- Rendered message text sent to recipient
    external_message_id VARCHAR(100) UNIQUE NULL, -- Hook mapping ID from simulation service
    status ENUM('pending', 'sent', 'delivered', 'failed', 'opened', 'read', 'clicked') DEFAULT 'pending',
    sent_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    INDEX idx_logs_campaign_id (campaign_id),
    INDEX idx_logs_external_id (external_message_id),
    INDEX idx_logs_status (status)
);

-- Table: campaign_analytics
CREATE TABLE campaign_analytics (
    campaign_id INT PRIMARY KEY,
    sent_count INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    opened_count INT DEFAULT 0,
    read_count INT DEFAULT 0,
    clicked_count INT DEFAULT 0,
    conversion_count INT DEFAULT 0, -- Conversions tracked if customers purchase after click
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
