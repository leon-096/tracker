/* =========================================================================
   config.js — FILL THESE TWO VALUES IN BEFORE USING THE APP
   -------------------------------------------------------------------------
   1. GIST_ID        -> the ID of a PRIVATE gist (from its URL).
   2. GITHUB_TOKEN   -> a fine-grained PAT with ONLY the "gists" permission
                        (read + write). Nothing else.

   See README.md for the step-by-step. The token ships in the JS bundle by
   design: anyone can write garbage to the gist, but nobody can read your
   data without your password.
   ========================================================================= */
window.TRACKER_CONFIG = {
  GIST_ID: "PASTE_YOUR_GIST_ID_HERE",
  GIST_FILENAME: "data.enc",
  GITHUB_TOKEN: "PASTE_YOUR_GIST_SCOPED_PAT_HERE",
  TIMEZONE: "Asia/Dhaka",
};
