#!/usr/bin/env node
/**
 * Utility script to generate a secure scrypt password hash for OWNER_PASSWORD_HASH.
 *
 * Usage (interactive — password is never visible):
 *   node scripts/generate-password-hash.mjs
 *   npm run auth:hash
 *
 * The script prompts for the password securely, confirms it, then outputs
 * the hash string ready to paste into .env.local.
 */

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const scryptAsync = promisify(scrypt);

/**
 * Prompts the user for input without echoing characters to the terminal.
 * Works in interactive terminals on Windows, macOS, and Linux.
 */
function askHidden(query) {
  return new Promise((resolve) => {
    // Mutable stream that suppresses output after the prompt is written
    const mutableStdout = new Writable({
      write(chunk, encoding, callback) {
        if (!this._muted) {
          process.stdout.write(chunk, encoding);
        }
        callback();
      },
    });
    mutableStdout._muted = false;

    const rl = createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });

    rl.question(query, (answer) => {
      rl.close();
      // Move to a new line after hidden input
      process.stdout.write("\n");
      resolve(answer);
    });

    // Mute output after the prompt text has been written
    mutableStdout._muted = true;
  });
}

async function main() {
  // If stdin is not a TTY (piped input), fall back to reading from stdin directly
  if (!process.stdin.isTTY) {
    console.error("Error: This script requires an interactive terminal for secure password entry.");
    console.error("Run it directly: node scripts/generate-password-hash.mjs");
    process.exit(1);
  }

  // Warn if password was accidentally passed as a CLI argument
  if (process.argv[2]) {
    console.warn("\n⚠  Warning: Passing the password as a command-line argument is insecure.");
    console.warn("   It may appear in shell history and process listings.");
    console.warn("   The script will prompt you securely instead.\n");
  }

  console.log("\n🔐 General Store — Secure Password Hash Generator\n");
  console.log("Your password will NOT be displayed as you type.\n");

  const password = await askHidden("  Enter store owner password: ");

  if (!password || password.trim().length === 0) {
    console.error("\n❌ Error: Password cannot be empty.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("\n❌ Error: Password must be at least 8 characters long.");
    process.exit(1);
  }

  const confirm = await askHidden("  Confirm store owner password: ");

  if (password !== confirm) {
    console.error("\n❌ Error: Passwords do not match. Please try again.");
    process.exit(1);
  }

  if (password.length < 12) {
    console.warn("\n⚠  Recommendation: Use a password of 12+ characters for stronger security.\n");
  }

  // Generate the hash
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });

  const hashString = `scrypt$N=16384,r=8,p=1$${salt}$${derivedKey.toString("hex")}`;

  console.log("\n=======================================================");
  console.log(" ✅ STORE OWNER PASSWORD HASH GENERATED SUCCESSFULLY");
  console.log("=======================================================\n");
  console.log("Copy and paste this into your .env.local file:\n");
  console.log(`OWNER_PASSWORD_HASH="${hashString}"\n`);
  console.log("Important:");
  console.log("  • Keep your plaintext password secret.");
  console.log("  • Never commit .env.local to version control.");
  console.log("  • Re-run this script to generate a new hash if needed.");
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Error generating password hash:", err);
  process.exit(1);
});
