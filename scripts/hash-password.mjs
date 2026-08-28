#!/usr/bin/env node
// Generate a bcrypt hash for the shared member password or the admin password.
//   node scripts/hash-password.mjs 'my-new-password'
// Paste the output into SQL:
//   update settings set member_password_hash = '<hash>' where id = 1;

import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error("Usage: node scripts/hash-password.mjs 'password'");
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
