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
}
