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

export interface AuthUser {
  id: number;
  full_name: string;
  username: string;
  email: string;
  role: 'admin' | 'accountant';
  permissions: UserPermissions;
  is_active: boolean;
  created_at?: string;
}

export type TransactionCurrency = 'USD' | 'SH.';

export interface CompanySettings {
  id: number;
  company_name: string;
  logo_url: string;
  address: string;
  phone: string;
  email: string;
  currency: string;
  currency_symbol: string;
  exchange_rate: number;
  description: string;
  report_header: string;
  quotation_header: string;
  footer_text: string;
  signature_name: string;
  signature_title: string;
  updated_at?: string;
}

export type ProjectStatus = 'Planning' | 'Active' | 'On Hold' | 'Completed' | 'Cancelled';

export interface Project {
  id: number;
  project_code: string;
  project_name: string;
  client_name: string;
  location: string;
  start_date: string;
  expected_completion_date: string;
  contract_amount: number;
  recorded_revenue: number | null;
  project_budget: number;
  description: string;
  status: ProjectStatus;
  total_expenses: number;
  expense_count: number;
  total_purchases: number;
  purchase_count: number;
  total_project_cost: number;
  remaining_budget: number;
  is_profit_calculable: boolean;
  profit_loss: number | null;
  created_at?: string;
}

export interface Expense {
  id: number;
  expense_date: string;
  expense_type: string;
  description: string;
  project_id: number;
  project_code?: string;
  project_name?: string;
  currency: TransactionCurrency;
  original_amount?: number;
  sh_amount?: number | null;
  usd_amount?: number;
  amount: number;
  payment_method: string;
  reference_number: string;
  notes: string;
  created_by_name?: string;
  created_at?: string;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  purchase_count?: number;
  total_purchased?: number;
}

export interface Purchase {
  id: number;
  purchase_date: string;
  supplier_id: number;
  supplier_name?: string;
  project_id: number;
  project_code?: string;
  project_name?: string;
  item_description: string;
  quantity: number;
  unit_label: string;
  currency: TransactionCurrency;
  original_unit_price?: number;
  original_total_amount?: number;
  sh_amount?: number | null;
  usd_amount?: number;
  unit_price: number;
  total_amount: number;
  payment_status: 'Paid' | 'Pending' | 'Partial';
  payment_method: string;
  invoice_number: string;
  notes: string;
  created_by_name?: string;
  created_at?: string;
}

export interface QuotationLineItem {
  id: number;
  date: string;
  description: string;
  currency: TransactionCurrency;
  sh_amount: number | null;
  usd_amount: number;
  amount: number;
  payment_method: string;
  reference_number: string;
  source_type: 'Expense' | 'Purchase';
}

export interface QuotationDocument {
  company: CompanySettings;
  exchangeRate: number;
  project: Project;
  documentDate: string;
  preparedBy: string;
  items: QuotationLineItem[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string;
  details_json: string;
  created_at: string;
}
