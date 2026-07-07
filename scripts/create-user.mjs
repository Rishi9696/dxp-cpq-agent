// Create (or update the password of) an allow-listed user.
//   node --env-file=.env.local scripts/create-user.mjs <email> <password>
//
// Signup is closed in this app — this script (using the service_role key)
// is the only way to provision an account. Run supabase/migrations/002_auth.sql
// once before creating your first user.
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node --env-file=.env.local scripts/create-user.mjs <email> <password>");
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. See .env.example.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { data: existing } = await supabase.auth.admin.listUsers();
const match = existing?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (match) {
  const { error } = await supabase.auth.admin.updateUserById(match.id, { password });
  if (error) {
    console.error(`Failed to update password: ${error.message}`);
    process.exit(1);
  }
  console.log(`Updated password for existing user ${email} (${match.id}).`);
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip the verification email — this is an internal tool
  });
  if (error) {
    console.error(`Failed to create user: ${error.message}`);
    process.exit(1);
  }
  console.log(`Created user ${email} (${data.user.id}).`);
}
