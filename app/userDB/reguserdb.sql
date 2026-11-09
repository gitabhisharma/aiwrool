-- Create a new table 
CREATE TABLE user (
    user_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR2(254 CHAR) NOT NULL,
    password_salt VARCHAR2(64 CHAR) NOT NULL,
    password_hash VARCHAR2(128 CHAR) NOT NULL,
    created_at TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    CONSTRAINT app_users_email_unique UNIQUE (email),
    CONSTRAINT app_users_email_lower CHECK (email = LOWER(email))
):