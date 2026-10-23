// supabase-client.js — bootstraps the Supabase browser client as a global.
//
// Two backends: the real one the family uses, and "Fly - Test" for
// everything else — Vercel preview links for branches, and localhost. Only
// the production hostnames reach real data, so testing a branch (or a
// mistake while developing) can never write to the live board.
//
// The publishable keys below are safe to ship in client-side code — that's
// what "publishable" means. They can only ever do what each project's RLS
// policies allow. They are NOT the secret keys; those live only in the Edge
// Functions' server-side environment and must never appear in this file.
const MG_BACKENDS = {
  live: {
    url: "https://fsdiuabmuicexdelkxtc.supabase.co",
    key: "sb_publishable_6yHPCTWbjP_kktHse74Mtg_nnONJp4F",
  },
  test: {
    url: "https://edktzqlbmrlcdgnzsiww.supabase.co",
    key: "sb_publishable_SYOMwWviCKlZtjzitl9Jcw_2tfYLQEV",
  },
};
const MG_LIVE_HOSTS = ["fly.arnavmody.com", "fly-orcin-tau.vercel.app"];
window.MG_BACKEND = MG_LIVE_HOSTS.includes(location.hostname) ? "live" : "test";

window.supabaseClient = supabase.createClient(
  MG_BACKENDS[window.MG_BACKEND].url,
  MG_BACKENDS[window.MG_BACKEND].key
);
