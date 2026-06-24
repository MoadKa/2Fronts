export type UserRole = 'customer' | 'admin'

export interface Profile {
  id: string
  role: UserRole
  company_name: string
  email: string
}

export interface Automation {
  id: string
  name: string
  summary: string
  outcome_description: string
  category: string
  price_cents: number
  currency: string
  is_active: boolean
  requires_provisioning: boolean
  // Which connector fulfils this automation. The purchase flow copies this onto
  // the provision row so its type DERIVES from the automation (not hardcoded).
  connector_type: string
  created_at: string
}

export type AutomationProvisionStatus = 'pending' | 'provisioning' | 'active' | 'failed' | 'cancelled'

export interface AutomationProvision {
  id: string
  request_id: string
  business_name: string
  booking_link: string
  business_hours: string | null
  twilio_phone_number: string | null
  twilio_phone_number_sid: string | null
  status: AutomationProvisionStatus
  // Which connector fulfils this provision (e.g. 'booking_concierge'); drives
  // which post-purchase setup screen My Requests links to. Optional: legacy rows
  // and some fixtures predate the column (DB default is 'twilio_missed_call').
  connector_type?: string
  // Connector-specific settings written at setup time (e.g. concierge_id once
  // the concierge has been configured via the wizard).
  config?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type ConnectorStatus = 'live' | 'coming_soon'

// A row of the connector_registry catalog. Drives the public Supported-software
// page; status separates available (live) from dimmed coming-soon cards.
export interface Connector {
  connector_type: string
  display_name: string
  category: string | null
  status: ConnectorStatus
  is_public: boolean
  sort_order: number
  created_at: string
}

export type RequestStatus =
  | 'requested'
  | 'payment_pending'
  | 'paid'
  | 'in_progress'
  | 'delivered'
  | 'cancelled'

export interface AutomationRequest {
  id: string
  automation_id: string
  customer_id: string
  status: RequestStatus
  stripe_checkout_session_id: string | null
  delivery_notes: string | null
  requested_at: string
  paid_at: string | null
  delivered_at: string | null
}

export interface AutomationRequestWithAutomation extends AutomationRequest {
  automation: Automation
  automation_provisions?: AutomationProvision[]
}

// --- First-connect column mapping (T6) -------------------------------------
// The AI proposes a spreadsheet column for each lead field, tagged with a
// confidence level. 'high' = auto-filled; 'low' = the customer MUST pick the
// column manually (we never guess low-confidence mappings). See F3 guard #1.
export type MappingConfidence = 'high' | 'low'

export interface MappingColumnOption {
  value: string
  label: string
}

export interface ProposedFieldMapping {
  field: string
  label: string
  // null when the AI is not confident enough to propose a column (low confidence).
  column: string | null
  columnLabel: string | null
  confidence: MappingConfidence
}

export interface ProposedMapping {
  connectorType: string
  sheetTitle: string
  fields: ProposedFieldMapping[]
  // One example lead: { field -> value }, rendered into the chosen columns as a preview.
  sampleLead: Record<string, string>
  availableColumns: MappingColumnOption[]
}

// The customer's final, confirmed column choice for one field.
export interface ConfirmedFieldMapping {
  field: string
  column: string
}
