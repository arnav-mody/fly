// supabase-client.js — bootstraps the Supabase browser client as a global.
//
// The publishable key below is safe to ship in client-side code — that's
// what "publishable" means. It can only ever do what the RLS policies in
// supabase/schema.sql allow (currently: read-only). It is NOT the secret
// key; that one lives only in the Edge Functions' server-side environment
// and must never appear in this file.
window.supabaseClient = supabase.createClient(
  "https://fsdiuabmuicexdelkxtc.supabase.co",
  "sb_publishable_6yHPCTWbjP_kktHse74Mtg_nnONJp4F"
);
