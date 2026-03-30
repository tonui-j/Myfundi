-- Role and function tables for MYFUNDI
CREATE TABLE IF NOT EXISTS roles (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS permissions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id) REFERENCES roles(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT IGNORE INTO roles (code, name) VALUES
('admin', 'Administrator'),
('customer', 'Customer'),
('worker', 'Worker');

INSERT IGNORE INTO permissions (code, description) VALUES
('auth.register', 'Create an account'),
('auth.login', 'Log into the system'),
('profile.view.self', 'View own profile'),
('booking.create', 'Create a booking request'),
('worker.profile.create.self', 'Create worker profile during registration'),
('admin.dashboard.view', 'View admin dashboard'),
('admin.worker.verify', 'Verify worker accounts'),
('admin.booking.view', 'View all bookings');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','booking.create')
WHERE r.code = 'customer';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','worker.profile.create.self')
WHERE r.code = 'worker';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('auth.register','auth.login','profile.view.self','admin.dashboard.view','admin.worker.verify','admin.booking.view')
WHERE r.code = 'admin';
