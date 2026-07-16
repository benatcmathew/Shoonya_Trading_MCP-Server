/**
 * SecureVault: Bank-level AES-256-GCM encrypted credential storage.
 * 
 * Security Architecture:
 * - AES-256-GCM encryption (same standard used by banks and governments)
 * - PBKDF2 key derivation with 310,000 iterations (OWASP 2023 recommendation)
 * - Unique random salt per vault (32 bytes)
 * - Unique random IV per encryption operation (16 bytes)
 * - Authentication tag prevents tampering (GCM mode)
 * - Credentials NEVER leave the local machine
 * - Credentials NEVER pass through the AI/LLM
 * - Vault file is unreadable without the master password
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const VAULT_DIR = path.join(os.homedir(), '.shoonya-mcp');
const VAULT_FILE = path.join(VAULT_DIR, 'vault.enc');
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const SALT_LENGTH = 32; // 256 bits
const TAG_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 310000; // OWASP 2023 recommendation for SHA-256
const PBKDF2_DIGEST = 'sha256';

export interface ShoonyaCredentials {
  user_id: string;
  password: string;
  totp_key: string;
  vendor_code: string;
  api_key: string;
  imei: string;
}

function deriveKey(masterPassword: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

function encrypt(plaintext: string, masterPassword: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterPassword, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Layout: [salt (32)] [iv (16)] [tag (16)] [encrypted data (...)]
  return Buffer.concat([salt, iv, tag, encrypted]);
}

function decrypt(data: Buffer, masterPassword: string): string {
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = deriveKey(masterPassword, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('DECRYPTION_FAILED: Invalid master password or corrupted vault.');
  }
}

export function vaultExists(): boolean {
  return fs.existsSync(VAULT_FILE);
}

export function saveCredentials(credentials: ShoonyaCredentials, masterPassword: string): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 }); // Owner-only permissions
  }

  const plaintext = JSON.stringify(credentials);
  const encryptedData = encrypt(plaintext, masterPassword);
  fs.writeFileSync(VAULT_FILE, encryptedData, { mode: 0o600 }); // Owner read/write only
}

export function loadCredentials(masterPassword: string): ShoonyaCredentials {
  if (!vaultExists()) {
    throw new Error('NO_VAULT: Credential vault not found. Run setup first.');
  }

  const encryptedData = fs.readFileSync(VAULT_FILE);
  const plaintext = decrypt(encryptedData, masterPassword);

  try {
    return JSON.parse(plaintext) as ShoonyaCredentials;
  } catch {
    throw new Error('PARSE_FAILED: Vault data is corrupted.');
  }
}

export function deleteVault(): boolean {
  if (vaultExists()) {
    // Overwrite with random data before deleting (secure wipe)
    const fileSize = fs.statSync(VAULT_FILE).size;
    fs.writeFileSync(VAULT_FILE, crypto.randomBytes(fileSize));
    fs.unlinkSync(VAULT_FILE);
    return true;
  }
  return false;
}

/**
 * Interactive CLI setup for credentials.
 * Used when running: npx shoonya-mcp-server --setup
 */
export async function interactiveSetup(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, hidden: boolean = false): Promise<string> => {
    return new Promise((resolve) => {
      if (hidden && process.stdin.isTTY) {
        // For hidden input in TTY mode
        process.stdout.write(question);
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let input = '';
        const onData = (char: string) => {
          if (char === '\n' || char === '\r' || char === '\u0004') {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(input);
          } else if (char === '\u0003') {
            process.exit();
          } else if (char === '\u007F' || char === '\b') {
            if (input.length > 0) {
              input = input.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else {
            input += char;
            process.stdout.write('*');
          }
        };
        stdin.on('data', onData);
      } else {
        rl.question(question, resolve);
      }
    });
  };

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        🔐 Shoonya MCP Server - Secure Credential Setup     ║');
  console.log('║                                                              ║');
  console.log('║  Your credentials will be encrypted with AES-256-GCM        ║');
  console.log('║  (bank-level encryption) and stored locally on this          ║');
  console.log('║  machine. They will NEVER be sent to any AI provider.       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (vaultExists()) {
    const overwrite = await ask('⚠️  A credential vault already exists. Overwrite? (yes/no): ');
    if (overwrite.toLowerCase() !== 'yes') {
      console.log('Setup cancelled.');
      rl.close();
      return;
    }
  }

  console.log('Enter your Shoonya broker credentials:\n');

  const user_id = await ask('  User ID: ');
  const password = await ask('  Password: ', true);
  const totp_key = await ask('  TOTP Secret Key: ', true);
  const vendor_code = await ask('  Vendor Code: ');
  const api_key = await ask('  API Key: ', true);
  const imei = await ask('  IMEI: ');

  console.log('\n🔑 Now set a Master Password to protect your vault.');
  console.log('   (You will need this each time the server starts)\n');

  const masterPassword = await ask('  Master Password: ', true);
  const confirmPassword = await ask('  Confirm Master Password: ', true);

  if (masterPassword !== confirmPassword) {
    console.log('\n❌ Passwords do not match. Setup cancelled.');
    rl.close();
    return;
  }

  if (masterPassword.length < 8) {
    console.log('\n❌ Master password must be at least 8 characters. Setup cancelled.');
    rl.close();
    return;
  }

  const credentials: ShoonyaCredentials = {
    user_id,
    password,
    totp_key,
    vendor_code,
    api_key,
    imei,
  };

  saveCredentials(credentials, masterPassword);

  console.log(`\n✅ Credentials encrypted and saved to: ${VAULT_FILE}`);
  console.log('🔒 Encryption: AES-256-GCM | Key Derivation: PBKDF2 (310,000 iterations)');
  console.log('\n🚀 You can now start the MCP server. It will read credentials from the vault.');
  console.log('   The AI will never see your passwords.\n');

  rl.close();
}
