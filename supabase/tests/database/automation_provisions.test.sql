begin;
select plan(12);

select has_table('public', 'automation_provisions', 'automation_provisions table should exist');
select has_column('public', 'automation_provisions', 'request_id', 'should have request_id column');
select has_column('public', 'automation_provisions', 'business_name', 'should have business_name column');
select has_column('public', 'automation_provisions', 'booking_link', 'should have booking_link column');
select has_column('public', 'automation_provisions', 'twilio_phone_number', 'should have twilio_phone_number column');
select has_column('public', 'automation_provisions', 'status', 'should have status column');
select col_is_unique('public', 'automation_provisions', 'request_id', 'request_id should be unique (idempotency guard)');
select col_is_unique('public', 'automation_provisions', 'twilio_phone_number', 'twilio_phone_number should be unique');

select results_eq(
  $$ select unnest(enum_range(null::automation_provision_status))::text $$,
  $$ values ('pending'), ('provisioning'), ('active'), ('failed'), ('cancelled') $$,
  'status should allow exactly: pending, provisioning, active, failed, cancelled'
);

select col_type_is('public', 'automation_provisions', 'business_hours', 'text', 'business_hours should be text, not jsonb (matches every app-layer consumer)');

-- booking_link is echoed verbatim into automated SMS sent to third parties;
-- this constraint is the actual enforcement boundary against a malformed
-- or oversized value reaching that point (client-side validation alone can
-- be bypassed by inserting directly against the REST API).
select isnt(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'booking_link_well_formed'),
  null,
  'booking_link_well_formed check constraint should exist'
);
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'booking_link_well_formed'),
  '\^https\?://',
  'booking_link_well_formed should require an http(s) scheme'
);

select * from finish();
rollback;
