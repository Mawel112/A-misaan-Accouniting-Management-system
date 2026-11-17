export const EXPENSE_TYPES = [
  'Material Purchases',
  'Labour Expenses',
  'Transportation Expenses',
  'Fuel Expenses',
  'Machinery & Equipment',
  'Subcontractor Expenses',
  'Site Expenses',
  'Maintenance & Repairs',
  'Electrical Materials',
  'Plumbing Materials',
  'Safety Equipment',
  'Tools & Equipment Purchases',
  'Professional Fees',
  'Office & Administrative Expenses',
  'Petty Cash Expenses',
  'Staff Salaries & Benefits',
  'Store & Inventory',
  'Legal & Government Fees',
  'Insurance Expenses',
  'Other Project Expenses',
] as const;

export type ExpenseType = (typeof EXPENSE_TYPES)[number];
