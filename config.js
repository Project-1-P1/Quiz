/** 🚀 SUPABASE CONFIGURATION */
const SUPABASE_URL = "https://avvjgnyfglnzwyexbzef.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UBqcJJlB-BSdOkkzpib2Lw_WJAOc0Hl";

// Initialize Supabase Client (Global Access)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
