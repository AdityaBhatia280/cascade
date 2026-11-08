-- ================================================================
-- CASCADE PROPERTY MANAGEMENT - DATABASE SCHEMA
-- PostgreSQL 14+
-- Last Modified: 2024-02-18
-- Author: Development Team
--
-- TABLES: tenants, leases, units, invoices, work_orders,
--         badge_access, vendors, cam_history
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- TENANTS
-- ----------------------------------------------------------------
CREATE TABLE tenants (
    tenant_id       VARCHAR(10)   PRIMARY KEY,
    tenant_name     VARCHAR(100)  NOT NULL,
    contact_name    VARCHAR(80),
    contact_email   VARCHAR(120),
    contact_phone   VARCHAR(20),
    tax_id          VARCHAR(20),
    tenant_type     VARCHAR(20)   DEFAULT 'COMMERCIAL'
                    CHECK (tenant_type IN ('COMMERCIAL','RETAIL',
                           'DATA_CENTER','OFFICE','INDUSTRIAL')),
    status          CHAR(1)       DEFAULT 'A'
                    CHECK (status IN ('A','I','P')),
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO tenants VALUES
('NW-001',    'Northwind Retail Corp',      'Janet Kowalski',
              'j.kowalski@northwind.com',   '(312) 555-0142',
              '36-4821957', 'RETAIL', 'A', NOW(), NOW()),
('ACME-DC',   'Acme Cloud Services LLC',    'Marcus Chen',
              'm.chen@acmecloud.io',        '(415) 555-0238',
              '82-1937456', 'DATA_CENTER', 'A', NOW(), NOW()),
('MRD-010',   'Meridian Analytics Group',   'Sarah Patel',
              's.patel@meridianag.com',     '(212) 555-0319',
              '45-6723891', 'OFFICE', 'A', NOW(), NOW()),
('SMT-020',   'Summit Engineering Inc',     'David Torres',
              'd.torres@summiteng.com',     '(303) 555-0487',
              '71-3948265', 'OFFICE', 'A', NOW(), NOW()),
('PIN-005',   'Pinnacle Financial Advisors','Lisa Nakamura',
              'l.nakamura@pinnaclefa.com',  '(617) 555-0156',
              '23-5891047', 'OFFICE', 'A', NOW(), NOW()),
('CST-030',   'Coastal Logistics Partners', 'Robert Kim',
              'r.kim@coastallog.com',       '(206) 555-0273',
              '58-2047163', 'INDUSTRIAL', 'A', NOW(), NOW());

-- ----------------------------------------------------------------
-- UNITS
-- ----------------------------------------------------------------
CREATE TABLE units (
    unit_id         VARCHAR(8)    PRIMARY KEY,
    building_id     VARCHAR(10)   NOT NULL DEFAULT 'CASCADE-1',
    floor_num       INTEGER,
    unit_name       VARCHAR(40),
    area_sf         NUMERIC(9,2)  NOT NULL,
    unit_type       VARCHAR(20)   DEFAULT 'OFFICE',
    hvac_zone       VARCHAR(10),
    ups_panel       VARCHAR(10),
    network_switch  VARCHAR(10),
    status          CHAR(1)       DEFAULT 'V'
                    CHECK (status IN ('O','V','M')),  -- Occupied, Vacant, Maintenance
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO units VALUES
('STE-110',  'CASCADE-1', 1, 'Suite 110 - Retail',
             8200.00, 'RETAIL', 'ZONE-1', 'UPS-A', 'SW-01', 'O', NOW()),
('DC-200',   'CASCADE-1', 2, 'Data Center Hall 200',
             12500.00, 'DATA_CENTER', 'ZONE-DC', 'UPS-B', 'SW-03', 'O', NOW()),
('STE-305',  'CASCADE-1', 3, 'Suite 305 - Office',
             4800.00, 'OFFICE', 'ZONE-3', 'UPS-A', 'SW-01', 'O', NOW()),
('STE-410',  'CASCADE-1', 4, 'Suite 410 - Office',
             6200.00, 'OFFICE', 'ZONE-4', 'UPS-A', 'SW-02', 'O', NOW()),
('STE-502',  'CASCADE-1', 5, 'Suite 502 - Office',
             3400.00, 'OFFICE', 'ZONE-5', 'UPS-A', 'SW-02', 'O', NOW()),
('WH-G01',   'CASCADE-1', 0, 'Warehouse Ground Level',
             15000.00, 'INDUSTRIAL', 'ZONE-W', 'UPS-A', 'SW-04', 'O', NOW());

-- ----------------------------------------------------------------
-- LEASES
-- ----------------------------------------------------------------
CREATE TABLE leases (
    lease_id            VARCHAR(12)  PRIMARY KEY,
    tenant_id           VARCHAR(10)  NOT NULL REFERENCES tenants(tenant_id),
    unit_id             VARCHAR(8)   NOT NULL REFERENCES units(unit_id),
    lease_status        CHAR(1)      DEFAULT 'A'
                        CHECK (lease_status IN ('A','E','P','T')),
    lease_type          CHAR(2)      DEFAULT 'MG'
                        CHECK (lease_type IN ('GR','NT','MG')),
    commence_date       DATE         NOT NULL,
    expire_date         DATE         NOT NULL,
    amendment_date      DATE,
    base_rent_monthly   NUMERIC(9,2) NOT NULL,
    rent_escalation_pct NUMERIC(5,2) DEFAULT 0.00,
    base_year           INTEGER,
    base_expense_psf    NUMERIC(7,2),
    current_expense_psf NUMERIC(7,2),
    cam_cap_type        CHAR(2)      DEFAULT '  ',
    cam_cap_pct         NUMERIC(5,2) DEFAULT 0.00,
    pro_rata_method     CHAR(1)      DEFAULT 'T',
    tenant_area_sf      NUMERIC(9,2),
    building_total_sf   NUMERIC(9,2) DEFAULT 50000.00,
    occupied_sf         NUMERIC(9,2) DEFAULT 42100.00,
    sla_tier            INTEGER      DEFAULT 0,
    monthly_fee         NUMERIC(9,2) DEFAULT 0.00,
    created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO leases VALUES
('LS-NW-2019',  'NW-001',  'STE-110', 'A', 'MG',
 '2019-03-01', '2029-02-28', '2023-06-15',
 14350.00, 3.00, 2021, 12.05, 13.40,
 'CU', 5.00, 'T', 8200.00, 50000.00, 42100.00,
 0, 0.00, NOW(), NOW()),
('LS-ACME-DC',  'ACME-DC', 'DC-200',  'A', 'NT',
 '2020-01-01', '2030-12-31', NULL,
 45000.00, 0.00, 2020, 18.50, 22.10,
 '  ', 0.00, 'T', 12500.00, 50000.00, 42100.00,
 4, 45000.00, NOW(), NOW()),
('LS-MRD-2022', 'MRD-010', 'STE-305', 'A', 'MG',
 '2022-07-01', '2027-06-30', NULL,
 8900.00, 2.50, 2022, 12.80, 13.40,
 'NC', 4.00, 'T', 4800.00, 50000.00, 42100.00,
 0, 0.00, NOW(), NOW()),
('LS-SMT-2021', 'SMT-020', 'STE-410', 'A', 'GR',
 '2021-01-01', '2026-12-31', NULL,
 15500.00, 3.50, 0, 0.00, 0.00,
 '  ', 0.00, 'T', 6200.00, 50000.00, 42100.00,
 0, 0.00, NOW(), NOW()),
('LS-PIN-2023', 'PIN-005', 'STE-502', 'A', 'MG',
 '2023-04-01', '2028-03-31', NULL,
 6800.00, 2.00, 2023, 13.20, 13.40,
 'CU', 6.00, 'T', 3400.00, 50000.00, 42100.00,
 0, 0.00, NOW(), NOW()),
('LS-CST-2020', 'CST-030', 'WH-G01',  'A', 'NT',
 '2020-06-01', '2030-05-31', NULL,
 22000.00, 0.00, 2020, 8.50, 10.20,
 '  ', 0.00, 'O', 15000.00, 50000.00, 42100.00,
 0, 0.00, NOW(), NOW());

-- ----------------------------------------------------------------
-- INVOICES
-- ----------------------------------------------------------------
CREATE TABLE invoices (
    invoice_id      SERIAL        PRIMARY KEY,
    lease_id        VARCHAR(12)   NOT NULL REFERENCES leases(lease_id),
    tenant_id       VARCHAR(10)   NOT NULL REFERENCES tenants(tenant_id),
    invoice_date    DATE          NOT NULL,
    base_rent       NUMERIC(9,2)  NOT NULL,
    cam_charge      NUMERIC(9,2)  DEFAULT 0.00,
    sla_credit      NUMERIC(9,2)  DEFAULT 0.00,
    total_amount    NUMERIC(11,2) NOT NULL,
    status          VARCHAR(10)   DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','SENT','PAID','VOID')),
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- WORK ORDERS
-- ----------------------------------------------------------------
CREATE TABLE work_orders (
    wo_id           SERIAL        PRIMARY KEY,
    unit_id         VARCHAR(8)    REFERENCES units(unit_id),
    tenant_id       VARCHAR(10)   REFERENCES tenants(tenant_id),
    vendor_id       VARCHAR(10),
    wo_type         VARCHAR(20)   NOT NULL
                    CHECK (wo_type IN ('HVAC','ELECTRICAL','PLUMBING',
                           'SECURITY','JANITORIAL','GENERAL')),
    description     TEXT,
    priority        INTEGER       DEFAULT 3
                    CHECK (priority BETWEEN 1 AND 5),
    status          VARCHAR(15)   DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN','ASSIGNED','IN_PROGRESS',
                           'COMPLETED','CANCELLED')),
    assigned_date   DATE,
    completed_date  DATE,
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- VENDORS
-- ----------------------------------------------------------------
CREATE TABLE vendors (
    vendor_id       VARCHAR(10)   PRIMARY KEY,
    vendor_name     VARCHAR(80)   NOT NULL,
    vendor_type     VARCHAR(20),
    contact_name    VARCHAR(80),
    contact_phone   VARCHAR(20),
    insurance_exp   DATE,
    status          CHAR(1)       DEFAULT 'A'
);

INSERT INTO vendors VALUES
('VND-HVAC01', 'ThermalTech HVAC Services',   'HVAC',
              'Mike Reynolds', '(312) 555-0891', '2025-06-30', 'A'),
('VND-ELEC01', 'PowerGrid Electrical Inc',    'ELECTRICAL',
              'Amy Wu',       '(312) 555-0734', '2025-09-15', 'A'),
('VND-SEC01',  'SecurePoint Access Systems',  'SECURITY',
              'James Hart',   '(312) 555-0456', '2025-03-31', 'A');

-- ----------------------------------------------------------------
-- BADGE ACCESS (PHYSICAL ACCESS CONTROL)
-- ----------------------------------------------------------------
CREATE TABLE badge_access (
    badge_id        SERIAL        PRIMARY KEY,
    vendor_id       VARCHAR(10),
    badge_group     VARCHAR(20)   NOT NULL,
    door_list       TEXT,
    access_level    INTEGER       DEFAULT 1,
    valid_from      DATE          NOT NULL,
    valid_until     DATE          NOT NULL,
    granted_by      VARCHAR(40)   DEFAULT 'SYSTEM',
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------
-- CAM HISTORY (FOR CAP CALCULATIONS)
-- ----------------------------------------------------------------
CREATE TABLE cam_history (
    history_id      SERIAL        PRIMARY KEY,
    lease_id        VARCHAR(12)   REFERENCES leases(lease_id),
    year            INTEGER       NOT NULL,
    expense_psf     NUMERIC(7,2)  NOT NULL,
    cam_charge      NUMERIC(9,2),
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
);

-- ================================================================
-- TRIGGER: AUTO-GRANT BADGE ACCESS WHEN WORK ORDER IS ASSIGNED
-- This trigger automatically inserts a badge_access record
-- for the vendor when a work order status changes to 'ASSIGNED'.
-- WARNING: This creates a physical security dependency on the
-- database — badge access is granted without security review.
-- ================================================================
CREATE OR REPLACE FUNCTION fn_grant_vendor_badge()
RETURNS TRIGGER AS $$
DECLARE
    v_unit_doors TEXT;
    v_vendor_name VARCHAR(80);
BEGIN
    IF NEW.status = 'ASSIGNED' AND NEW.vendor_id IS NOT NULL THEN
        -- Get the doors associated with the unit
        SELECT 'DOOR-' || u.floor_num || '-MAIN, DOOR-' ||
               u.floor_num || '-SERVICE'
        INTO v_unit_doors
        FROM units u
        WHERE u.unit_id = NEW.unit_id;

        -- Get vendor name for badge group
        SELECT vendor_name INTO v_vendor_name
        FROM vendors
        WHERE vendor_id = NEW.vendor_id;

        -- AUTO-GRANT: Insert badge access for vendor
        INSERT INTO badge_access (
            vendor_id, badge_group, door_list, access_level,
            valid_from, valid_until, granted_by
        ) VALUES (
            NEW.vendor_id,
            'VENDOR-' || NEW.wo_type,
            v_unit_doors,
            2,
            CURRENT_DATE,
            CURRENT_DATE + INTERVAL '30 days',
            'WO-TRIGGER-AUTO'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_order_badge
    AFTER INSERT OR UPDATE ON work_orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_grant_vendor_badge();

-- ================================================================
-- INDEXES
-- ================================================================
CREATE INDEX idx_leases_tenant ON leases(tenant_id);
CREATE INDEX idx_leases_unit ON leases(unit_id);
CREATE INDEX idx_invoices_lease ON invoices(lease_id);
CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_work_orders_unit ON work_orders(unit_id);
CREATE INDEX idx_work_orders_vendor ON work_orders(vendor_id);
CREATE INDEX idx_badge_access_vendor ON badge_access(vendor_id);

COMMIT;
