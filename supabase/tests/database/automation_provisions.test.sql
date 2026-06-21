begin;
select plan(9);

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

select * from finish();
rollback;
