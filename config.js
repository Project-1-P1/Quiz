/** 🚀 SUPABASE CONFIGURATION */
const SUPABASE_URL = "https://hwllcgpdltcepztwefrm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xAyGvh-d6HtVm_7ae12Duw_J1KkO-cV";

// Initialize Supabase Client (Global Access)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);