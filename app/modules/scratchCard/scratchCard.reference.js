const crypto = require("crypto");

// No 0/O, 1/I/L so a customer can read the code out over the phone without mix-ups.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const PREFIX = "SC-";

// Random customer-facing reference, e.g. "SC-7K4Q9P". Unlike the row Id it
// reveals nothing about how many claims exist and can't be guessed in sequence.
const generateReferenceCode = () => {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return PREFIX + code;
};

// Accepts what an admin types ("sc-7k4q9p", "7K4Q9P", " SC-7K4Q9P ") and
// returns the stored form.
const normalizeReferenceCode = (value) => {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.startsWith(PREFIX)) return raw;
  // A bare code can itself start with "SC", so only strip it from a longer value.
  return PREFIX + (raw.length === CODE_LENGTH ? raw : raw.replace(/^SC/, ""));
};

module.exports = { generateReferenceCode, normalizeReferenceCode };
