import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'amiisaan.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export interface UserPermissions {
  dashboard: boolean;
  projects: boolean;
  expenses: boolean;
  quotations: boolean;
  purchases: boolean;
  reports: boolean;
  settings: boolean;
  allowedProjectIds: number[] | 'all';
}

export const DEFAULT_ADMIN_PERMISSIONS: UserPermissions = {
  dashboard: true,
  projects: true,
  expenses: true,
  quotations: true,
  purchases: true,
  reports: true,
  settings: true,
  allowedProjectIds: 'all',
};

export const DEFAULT_ACCOUNTANT_PERMISSIONS: UserPermissions = {
  dashboard: true,
  projects: true,
  expenses: true,
  quotations: false,
  purchases: false,
  reports: false,
  settings: false,
  allowedProjectIds: 'all',
};

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'accountant')),
      permissions_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      company_name TEXT NOT NULL,
      logo_url TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      currency_symbol TEXT NOT NULL DEFAULT '$',
      exchange_rate REAL NOT NULL DEFAULT 8500,
      description TEXT NOT NULL,
      report_header TEXT NOT NULL,
      quotation_header TEXT NOT NULL,
      footer_text TEXT NOT NULL,
      signature_name TEXT NOT NULL,
      signature_title TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_code TEXT NOT NULL UNIQUE,
      project_name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      location TEXT NOT NULL,
      start_date TEXT NOT NULL,
      expected_completion_date TEXT NOT NULL,
      contract_amount REAL NOT NULL DEFAULT 0,
      recorded_revenue REAL,
      project_budget REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Planning', 'Active', 'On Hold', 'Completed', 'Cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      contact_person TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      expense_type TEXT NOT NULL DEFAULT 'Other Project Expenses',
      description TEXT NOT NULL,
      project_id INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      original_amount REAL,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_method TEXT NOT NULL,
      reference_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      import_hash TEXT UNIQUE,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_date TEXT NOT NULL,
      supplier_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      item_description TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      unit_label TEXT NOT NULL DEFAULT 'Units',
      currency TEXT NOT NULL DEFAULT 'USD',
      original_unit_price REAL,
      original_total_amount REAL,
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      total_amount REAL NOT NULL CHECK(total_amount >= 0),
      payment_status TEXT NOT NULL DEFAULT 'Paid' CHECK(payment_status IN ('Paid', 'Pending', 'Partial')),
      payment_method TEXT NOT NULL DEFAULT 'Bank Transfer',
      invoice_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      summary TEXT NOT NULL,
      details_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_purchases_project ON purchases(project_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  // Safe migrations for existing databases
  const settingsColumns = db.prepare('PRAGMA table_info(company_settings)').all() as Array<{ name: string }>;
  if (!settingsColumns.some((col) => col.name === 'exchange_rate')) {
    db.exec('ALTER TABLE company_settings ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 8500;');
  }

  const expenseColumns = db.prepare('PRAGMA table_info(expenses)').all() as Array<{ name: string }>;
  if (!expenseColumns.some((col) => col.name === 'expense_type')) {
    db.exec("ALTER TABLE expenses ADD COLUMN expense_type TEXT NOT NULL DEFAULT 'Other Project Expenses';");
  }
  if (!expenseColumns.some((col) => col.name === 'currency')) {
    db.exec("ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';");
  }
  if (!expenseColumns.some((col) => col.name === 'original_amount')) {
    db.exec('ALTER TABLE expenses ADD COLUMN original_amount REAL;');
    db.exec('UPDATE expenses SET original_amount = amount WHERE original_amount IS NULL;');
  }

  const purchaseColumns = db.prepare('PRAGMA table_info(purchases)').all() as Array<{ name: string }>;
  if (!purchaseColumns.some((col) => col.name === 'currency')) {
    db.exec("ALTER TABLE purchases ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';");
  }
  if (!purchaseColumns.some((col) => col.name === 'original_unit_price')) {
    db.exec('ALTER TABLE purchases ADD COLUMN original_unit_price REAL;');
    db.exec('UPDATE purchases SET original_unit_price = unit_price WHERE original_unit_price IS NULL;');
  }
  if (!purchaseColumns.some((col) => col.name === 'original_total_amount')) {
    db.exec('ALTER TABLE purchases ADD COLUMN original_total_amount REAL;');
    db.exec('UPDATE purchases SET original_total_amount = total_amount WHERE original_total_amount IS NULL;');
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    seedInitialData();
  }
}

function seedInitialData(): void {
  const adminHash = bcrypt.hashSync('Admin@123', 10);
  const accountantHash = bcrypt.hashSync('Accountant@123', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (full_name, username, email, password_hash, role, permissions_json, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const adminResult = insertUser.run(
    'Eng. Abdirahman Farah',
    'admin',
    'admin@amiisaan.com',
    adminHash,
    'admin',
    JSON.stringify(DEFAULT_ADMIN_PERMISSIONS)
  );
  const adminId = Number(adminResult.lastInsertRowid);

  insertUser.run(
    'Halima Warsame',
    'accountant',
    'accountant@amiisaan.com',
    accountantHash,
    'accountant',
    JSON.stringify(DEFAULT_ACCOUNTANT_PERMISSIONS)
  );

  db.prepare(`
    INSERT INTO company_settings (
      id, company_name, logo_url, address, phone, email, currency, currency_symbol, exchange_rate,
      description, report_header, quotation_header, footer_text, signature_name, signature_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    1,
    'A-MIISAAN CONSTRUCTION CO.',
    '/src/assets/images/amiisaan_logo_1794870104636.jpg',
    'KM4 Junction, Hodan District, Mogadishu',
    '+252 61 500 4420',
    'finance@amiisaan.com',
    'USD',
    '$',
    8500,
    'Civil engineering, commercial building construction, and infrastructure contracting.',
    'OFFICIAL FINANCIAL REPORT',
    'PROJECT QUOTATION / FINANCIAL SUMMARY',
    'A-MIISAAN CONSTRUCTION CO. · Certified Financial & Project Accounting Record',
    'Eng. Abdirahman Farah',
    'Managing Director / Chief Finance Officer'
  );

  const insertProject = db.prepare(`
    INSERT INTO projects (
      project_code, project_name, client_name, location, start_date, expected_completion_date,
      contract_amount, recorded_revenue, project_budget, description, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pr1 = insertProject.run(
    'PR1',
    'Building Construction',
    'Banaadir Commercial Group',
    'Hodan District, Mogadishu',
    '2026-11-01',
    '2027-05-01',
    85000,
    42000,
    68000,
    'Four-story reinforced concrete commercial office building including MEP and finishing works.',
    'Active'
  );
  const pr1Id = Number(pr1.lastInsertRowid);

  const pr2 = insertProject.run(
    'PR2',
    'Waberi Logistics Warehouse',
    'Horn Freight & Logistics',
    'Waberi Port Corridor',
    '2026-10-15',
    '2027-03-30',
    120000,
    60000,
    95000,
    'Steel-frame industrial warehouse with heavy-duty concrete slab and perimeter security wall.',
    'Active'
  );
  const pr2Id = Number(pr2.lastInsertRowid);

  const pr3 = insertProject.run(
    'PR3',
    'Road & Drainage Rehabilitation',
    'Municipal Infrastructure Authority',
    'Karaan Sector 3',
    '2026-11-10',
    '2027-06-15',
    64000,
    null,
    52000,
    'Stormwater culvert drainage channels and compacted asphalt access road resurfacing.',
    'Planning'
  );
  const pr3Id = Number(pr3.lastInsertRowid);

  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (name, contact_person, phone, email, address, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const sup1 = insertSupplier.run(
    'ABC Building Materials',
    'Hassan Nur',
    '+252 61 522 1190',
    'sales@abcbuilding.so',
    'Bakara Industrial Road',
    'Primary cement, rebar, and aggregates vendor'
  );
  const sup1Id = Number(sup1.lastInsertRowid);

  const sup2 = insertSupplier.run(
    'Horn Steel & Cement Ltd.',
    'Mohamed Ali',
    '+252 61 544 8832',
    'orders@hornsteel.so',
    'Port Industrial Zone',
    'Structural steel beams and reinforcement bars'
  );
  const sup2Id = Number(sup2.lastInsertRowid);

  const sup3 = insertSupplier.run(
    'Waberi Heavy Equipment',
    'Fadumo Duale',
    '+252 61 599 3011',
    'dispatch@waberiequip.so',
    'KM5 Industrial Yard',
    'Concrete mixers, excavators, and haulage'
  );
  const sup3Id = Number(sup3.lastInsertRowid);

  const insertExpense = db.prepare(`
    INSERT INTO expenses (expense_date, description, project_id, amount, payment_method, reference_number, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertExpense.run('2026-11-01', 'Labor Payment — Foundation Crew', pr1Id, 500, 'Cash', 'EXP-1001', 'Weekly site labor payout', adminId);
  insertExpense.run('2026-11-05', 'Site Material Transport & Haulage', pr1Id, 100, 'Cash', 'EXP-1002', 'Truck delivery to Hodan site', adminId);
  insertExpense.run('2026-11-12', 'Electrical Conduit Installation Labor', pr1Id, 750, 'Bank Transfer', 'EXP-1003', 'Subcontractor milestone 1', adminId);
  insertExpense.run('2026-11-16', 'Site Supervision & Safety Gear', pr1Id, 420, 'Mobile Money', 'EXP-1004', 'PPE helmets and vests', adminId);
  insertExpense.run('2026-10-24', 'Excavation Fuel & Operator Wages', pr2Id, 1850, 'Bank Transfer', 'EXP-1005', 'Site clearing phase', adminId);
  insertExpense.run('2026-11-08', 'Steel Erection Crew Payroll', pr2Id, 3400, 'Bank Transfer', 'EXP-1006', 'Column & truss assembly', adminId);
  insertExpense.run('2026-11-14', 'Topographic Survey & Soil Testing', pr3Id, 950, 'Cheque', 'EXP-1007', 'Drainage slope survey', adminId);

  const insertPurchase = db.prepare(`
    INSERT INTO purchases (
      purchase_date, supplier_id, project_id, item_description, quantity, unit_label,
      unit_price, total_amount, payment_status, payment_method, invoice_number, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertPurchase.run('2026-11-03', sup1Id, pr1Id, 'Portland Cement (50kg)', 100, 'Bags', 8, 800, 'Paid', 'Bank Transfer', 'INV-2026-011', 'Foundation concrete batch', adminId);
  insertPurchase.run('2026-11-10', sup2Id, pr1Id, 'Deformed Rebar Steel (16mm)', 45, 'Tons', 720, 32400, 'Partial', 'Bank Transfer', 'INV-2026-019', 'Structural column reinforcement', adminId);
  insertPurchase.run('2026-10-20', sup2Id, pr2Id, 'I-Beam Structural Steel', 28, 'Beams', 450, 12600, 'Paid', 'Bank Transfer', 'INV-2026-004', 'Warehouse roof trusses', adminId);
  insertPurchase.run('2026-11-06', sup1Id, pr2Id, 'Ready-Mix Concrete Grade 30', 60, 'm3', 135, 8100, 'Paid', 'Bank Transfer', 'INV-2026-015', 'Warehouse slab pour', adminId);
  insertPurchase.run('2026-11-15', sup3Id, pr3Id, 'Precast Culvert Box Sections', 18, 'Units', 320, 5760, 'Pending', 'Cheque', 'INV-2026-024', 'Pending delivery verification', adminId);

  db.prepare(`
    INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, summary, details_json)
    VALUES (?, ?, 'CREATE', 'settings', 1, 'Initialized A-MIISAAN CONSTRUCTION CO. accounting database', '{}')
  `).run(adminId, 'Eng. Abdirahman Farah');
}
