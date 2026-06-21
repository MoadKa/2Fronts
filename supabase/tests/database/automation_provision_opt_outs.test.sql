begin;
select plan(4);

select has_table('public', 'automation_provision_opt_outs', 'automation_provision_opt_outs table should exist');
select has_column('public', 'automation_provision_opt_outs', 'provision_id', 'should have provision_id column');
select has_column('public', 'automation_provision_opt_outs', 'phone', 'should have phone column');
select col_is_unique('public', 'automation_provision_opt_outs', array['provision_id', 'phone'], 'a phone should only opt out once per provision');

select * from finish();
rollback;
