const crypto = require("crypto");
const ApiError = require("../../../error/ApiError");
const { getClientIp } = require("../../utils/clientIp");
const FacebookPixelService = require("../facebookPixel/facebookPixel.service");
const TiktokPixelService = require("../tiktokPixel/tiktokPixel.service");
const GoogleAdsService = require("../googleAds/googleAds.service");

const hash = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

const normalizeBangladeshPhones = (value) => {
  if (!value) return [];
  const digits = String(value).replace(/\D/g, "").replace(/^00/, "");
  if (!digits) return [];

  let intl = "";
  if (digits.startsWith("8801") && digits.length === 13) {
    intl = digits;
  } else if (digits.startsWith("01") && digits.length === 11) {
    intl = `88${digits}`;
  } else if (digits.startsWith("1") && digits.length === 10) {
    intl = `880${digits}`;
  } else {
    intl = digits;
  }

  const local = intl.startsWith("88") ? intl.slice(2) : intl;
  // Return unique hashes: international format (8801...) first as required by Meta, plus local format
  return Array.from(new Set([intl, local])).filter(Boolean);
};

const hashPhone = (value) => {
  const phones = normalizeBangladeshPhones(value);
  if (!phones.length) return undefined;
  // First item is standard 8801... for backwards compatibility
  return hash(phones[0]);
};

const asHashArray = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const valid = value.map(hash).filter(Boolean);
    return valid.length ? valid : undefined;
  }
  const h = hash(value);
  return h ? [h] : undefined;
};

const isValidEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const s = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  // Exclude internal placeholders
  if (s.includes("@customer.kafela.local") || s.endsWith(".local") || s.includes("example.com")) {
    return false;
  }
  return true;
};

const cleanNamePart = (str) =>
  String(str || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();

const parseCustomerName = (fnInput, lnInput, nameInput) => {
  let fn = cleanNamePart(fnInput);
  let ln = cleanNamePart(lnInput);

  if ((!fn || !ln) && nameInput) {
    const raw = cleanNamePart(nameInput);
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      if (!fn) fn = parts[0];
    } else if (parts.length === 2) {
      if (!fn) fn = parts[0];
      if (!ln) ln = parts[1];
    } else if (parts.length > 2) {
      if (!fn) fn = parts[0];
      if (!ln) ln = parts.slice(1).join(" ");
    }
  }

  const allFirstNames = Array.from(new Set([fn])).filter(Boolean);
  const allLastNames = Array.from(new Set([ln])).filter(Boolean);

  return { firstName: fn, lastName: ln, allFirstNames, allLastNames };
};

const BD_DISTRICTS = [
  "dhaka", "gazipur", "narayanganj", "chattogram", "chittagong", "sylhet",
  "rajshahi", "khulna", "barishal", "barisal", "rangpur", "mymensingh",
  "cumilla", "comilla", "feni", "brahmanbaria", "noakhali", "chandpur",
  "lakshmipur", "coxsbazar", "tangail", "kishoreganj", "manikganj", "munshiganj",
  "narsingdi", "faridpur", "gopalganj", "madaripur", "rajbari", "shariatpur",
  "bogura", "bogra", "pabna", "sirajganj", "naogaon", "natore", "jashore",
  "jessore", "satkhira", "kushtia", "dinajpur", "patuakhali", "bhola",
  "moulvibazar", "habiganj", "sunamganj", "jamalpur", "netrokona"
];

const cleanGeoString = (val) =>
  String(val || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();

const resolveBangladeshCity = (city, district, address) => {
  const d = String(district || "").toLowerCase().trim();
  const c = String(city || "").toLowerCase().trim();
  const a = String(address || "").toLowerCase();

  if (d === "inside" || d === "inside_dhaka" || d.includes("dhaka") || c.includes("dhaka") || a.includes("dhaka") || a.includes("ঢাকা")) {
    return "dhaka";
  }

  if (c && c !== "outside") {
    const matched = BD_DISTRICTS.find((dist) => c.includes(dist));
    if (matched) return matched;
    const cleaned = cleanGeoString(c);
    if (cleaned) return cleaned;
  }

  if (d && d !== "outside") {
    const matched = BD_DISTRICTS.find((dist) => d.includes(dist));
    if (matched) return matched;
    const cleaned = cleanGeoString(d);
    if (cleaned) return cleaned;
  }

  const addressMatch = BD_DISTRICTS.find((dist) => a.includes(dist));
  if (addressMatch) return addressMatch;

  return undefined;
};

const DIVISION_MAP = {
  dhaka: "dhaka",
  gazipur: "dhaka",
  narayanganj: "dhaka",
  tangail: "dhaka",
  narsingdi: "dhaka",
  munshiganj: "dhaka",
  manikganj: "dhaka",
  kishoreganj: "dhaka",
  faridpur: "dhaka",
  gopalganj: "dhaka",
  madaripur: "dhaka",
  rajbari: "dhaka",
  shariatpur: "dhaka",
  inside: "dhaka",
  chattogram: "chittagong",
  chittagong: "chittagong",
  cumilla: "chittagong",
  comilla: "chittagong",
  feni: "chittagong",
  brahmanbaria: "chittagong",
  noakhali: "chittagong",
  chandpur: "chittagong",
  lakshmipur: "chittagong",
  coxsbazar: "chittagong",
  sylhet: "sylhet",
  moulvibazar: "sylhet",
  habiganj: "sylhet",
  sunamganj: "sylhet",
  rajshahi: "rajshahi",
  bogura: "rajshahi",
  bogra: "rajshahi",
  pabna: "rajshahi",
  sirajganj: "rajshahi",
  naogaon: "rajshahi",
  natore: "rajshahi",
  khulna: "khulna",
  jashore: "khulna",
  jessore: "khulna",
  satkhira: "khulna",
  kushtia: "khulna",
  barishal: "barisal",
  barisal: "barisal",
  patuakhali: "barisal",
  bhola: "barisal",
  rangpur: "rangpur",
  dinajpur: "rangpur",
  mymensingh: "mymensingh",
  jamalpur: "mymensingh",
  netrokona: "mymensingh",
};

const resolveBangladeshState = (state, district, city) => {
  const s = String(state || "").toLowerCase().trim();
  if (s) return cleanGeoString(s);

  const key = cleanGeoString(city || district || "");
  if (key && DIVISION_MAP[key]) return DIVISION_MAP[key];

  return undefined;
};

const resolvePostalCode = (zip, postalCode, address) => {
  const z = String(zip || postalCode || "").trim();
  if (/^\d{4}$/.test(z)) return z;

  if (address) {
    const match = String(address).match(/\b(1\d{3}|2\d{3}|3\d{3}|4\d{3}|5\d{3}|6\d{3}|7\d{3}|8\d{3}|9\d{3})\b/);
    if (match) return match[1];
  }
  return undefined;
};

const sanitizeFbc = (fbc) => {
  if (!fbc) return undefined;
  const str = String(fbc).trim();
  if (/^fb\.1\.\d+\..+$/.test(str)) return str;
  if (/^[a-zA-Z0-9_\-]+$/.test(str) && str.length > 10) {
    return `fb.1.${Date.now()}.${str}`;
  }
  return undefined;
};

const sanitizeFbp = (fbp) => {
  if (!fbp) return undefined;
  const str = String(fbp).trim();
  if (/^fb\.1\.\d+\.\d+$/.test(str)) return str;
  return undefined;
};

const isPrivateIp = (ip) => {
  if (!ip) return true;
  const clean = String(ip).replace(/^::ffff:/, "").trim();
  if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost") return true;
  if (/^10\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(clean)) return true;
  if (/^fc00:|^fe80:/i.test(clean)) return true;
  return false;
};

const getTrackingClientIp = (req) => {
  if (!req) return null;
  const direct = getClientIp(req);
  if (direct && !isPrivateIp(direct)) return direct;

  const cf = req.headers?.["cf-connecting-ip"];
  if (cf && !isPrivateIp(cf)) return String(cf).trim();

  const real = req.headers?.["x-real-ip"];
  if (real && !isPrivateIp(real)) return String(real).trim();

  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const list = forwarded.split(",").map((s) => s.trim().replace(/^::ffff:/, ""));
    const pub = list.find((ip) => !isPrivateIp(ip));
    if (pub) return pub;
  }

  const clientHeader = req.headers?.["x-client-ip"];
  if (clientHeader && !isPrivateIp(clientHeader)) return String(clientHeader).trim();

  return direct || null;
};

const formatCustomData = (data = {}) => {
  const res = { ...data };
  if (res.value !== undefined) res.value = Number(res.value);
  if (!res.currency) res.currency = "BDT";
  if (!res.content_type) res.content_type = "product";

  if (Array.isArray(res.content_ids)) {
    res.content_ids = res.content_ids.map(String);
  } else if (res.content_id) {
    res.content_ids = [String(res.content_id)];
  }

  if (Array.isArray(res.contents)) {
    res.contents = res.contents
      .map((item) => ({
        id: String(item.id || item.productId || ""),
        quantity: Number(item.quantity || item.qty || 1),
        item_price: Number(item.item_price || item.price || 0),
      }))
      .filter((c) => c.id);
  } else if (res.content_ids && res.content_ids.length > 0) {
    const singlePrice = res.value && res.num_items ? res.value / res.num_items : res.value || 0;
    res.contents = res.content_ids.map((id) => ({
      id: String(id),
      quantity: Number(res.num_items || 1),
      item_price: Number(singlePrice),
    }));
  }

  return res;
};

const PLATFORM_EVENT_NAMES = {
  PageView: { meta: "PageView", tiktok: "Pageview" },
  ViewContent: { meta: "ViewContent", tiktok: "ViewContent" },
  Search: { meta: "Search", tiktok: "Search" },
  AddToCart: { meta: "AddToCart", tiktok: "AddToCart" },
  InitiateCheckout: { meta: "InitiateCheckout", tiktok: "InitiateCheckout" },
  AddPaymentInfo: { meta: "AddPaymentInfo", tiktok: "AddPaymentInfo" },
  Lead: { meta: "Lead", tiktok: "SubmitForm" },
  Contact: { meta: "Contact", tiktok: "Contact" },
  Purchase: { meta: "Purchase", tiktok: "CompletePayment" },
};

const getPlatformEventName = (eventName, platform) =>
  PLATFORM_EVENT_NAMES[eventName]?.[platform] || eventName;

const clean = (obj) =>
  Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0)
    )
  );

const postJson = async (url, payload, headers = {}) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok && !data.error && !data.partialFailureError && (!("code" in data) || Number(data.code) === 0),
    status: res.status,
    data,
  };
};

const toMetaEvent = ({ eventName, eventId, eventSourceUrl, userData = {}, customData = {}, ipAddress, userAgent }) => {
  const phoneList = normalizeBangladeshPhones(userData.phone);
  const hashedPhones = phoneList.map(hash).filter(Boolean);

  const email = isValidEmail(userData.email) ? userData.email : undefined;
  const hashedEmails = email ? [hash(email)] : undefined;

  const { allFirstNames, allLastNames } = parseCustomerName(
    userData.firstName,
    userData.lastName,
    userData.name
  );
  const hashedFn = allFirstNames.map(hash).filter(Boolean);
  const hashedLn = allLastNames.map(hash).filter(Boolean);

  const city = resolveBangladeshCity(userData.city, userData.district, userData.address);
  const hashedCity = city ? [hash(cleanGeoString(city))] : undefined;

  const state = resolveBangladeshState(userData.state, userData.district, city);
  const hashedState = state ? [hash(cleanGeoString(state))] : undefined;

  const zip = resolvePostalCode(userData.zip, userData.postalCode, userData.address);
  const hashedZip = zip ? [hash(cleanGeoString(zip))] : undefined;

  // Country: Bangladesh is always "bd"
  const hashedCountry = [hash("bd")];

  const externalIds = [];
  if (userData.customerId) externalIds.push(String(userData.customerId));
  if (userData.externalId) externalIds.push(String(userData.externalId));
  if (userData.deviceId) externalIds.push(String(userData.deviceId));
  if (phoneList.length) externalIds.push(phoneList[0]);
  const hashedExternalIds = Array.from(new Set(externalIds)).map(hash).filter(Boolean);

  return {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: clean({
      client_ip_address: ipAddress,
      client_user_agent: userAgent,
      em: hashedEmails,
      ph: hashedPhones.length ? hashedPhones : undefined,
      fn: hashedFn.length ? hashedFn : undefined,
      ln: hashedLn.length ? hashedLn : undefined,
      ct: hashedCity,
      st: hashedState,
      zp: hashedZip,
      country: hashedCountry,
      external_id: hashedExternalIds.length ? hashedExternalIds : undefined,
      fbp: sanitizeFbp(userData.fbp),
      fbc: sanitizeFbc(userData.fbc),
    }),
    custom_data: clean(formatCustomData(customData)),
  };
};

const sendMeta = async (payload, context) => {
  const pixels = await FacebookPixelService.getActiveFromDB();
  const results = [];
  for (const pixel of pixels) {
    const row = pixel.toJSON();
    if (!row.pixelsId || !row.metaAccessToken) continue;
    const apiVersion = process.env.META_GRAPH_API_VERSION || "v23.0";
    const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(row.pixelsId)}/events?access_token=${encodeURIComponent(row.metaAccessToken)}`;
    const testCode = payload.testEventCode || (process.env.NODE_ENV !== "production" ? row.testEventId : undefined);
    const body = {
      data: [
        toMetaEvent({
          ...payload,
          eventName: getPlatformEventName(payload.eventName, "meta"),
          ...context,
        }),
      ],
      ...(testCode ? { test_event_code: testCode } : {}),
    };
    results.push({ platform: "meta", pixelId: row.pixelsId, ...(await postJson(url, body)) });
  }
  return results;
};

const toTiktokEvent = ({ eventName, eventId, eventSourceUrl, referrerUrl, userData = {}, customData, ipAddress, userAgent }) => {
  const phoneList = normalizeBangladeshPhones(userData.phone);
  return {
    event: getPlatformEventName(eventName, "tiktok"),
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    user: clean({
      ip: ipAddress,
      user_agent: userAgent,
      email: isValidEmail(userData.email) ? hash(userData.email) : undefined,
      phone: phoneList.length ? hash(phoneList[0]) : undefined,
      external_id: userData.customerId ? hash(String(userData.customerId)) : undefined,
      ttclid: userData.ttclid,
      ttp: userData.ttp,
    }),
    properties: clean(formatCustomData(customData)),
    page: clean({ url: eventSourceUrl, referrer: referrerUrl }),
  };
};

const sendTiktok = async (payload, context) => {
  const pixels = await TiktokPixelService.getActiveFromDB();
  const results = [];
  for (const pixel of pixels) {
    const row = pixel.toJSON();
    if (!row.pixelCode || !row.accessToken) continue;
    const testCode = payload.testEventCode || (process.env.NODE_ENV !== "production" ? row.testEventCode : undefined);
    const body = {
      pixel_code: row.pixelCode,
      event_source: "web",
      event_source_id: row.pixelCode,
      data: [toTiktokEvent({ ...payload, ...context })],
      ...(testCode ? { test_event_code: testCode } : {}),
    };
    results.push({
      platform: "tiktok",
      pixelCode: row.pixelCode,
      ...(await postJson("https://business-api.tiktok.com/open_api/v1.3/event/track/", body, {
        "Access-Token": row.accessToken,
      })),
    });
  }
  return results;
};

const getGoogleAccessToken = async (config = {}) => {
  const clientId = config.clientId || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = config.refreshToken || process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google Ads token request failed");
  }
  return data.access_token;
};

const getGoogleClickId = (userData = {}) =>
  userData.gclid || userData.gbraid || userData.wbraid || null;

const sendGoogleAds = async (payload) => {
  if (payload.eventName !== "Purchase") return [];

  const configs = await GoogleAdsService.getActiveFromDB();
  const results = [];
  for (const config of configs) {
    const row = config.toJSON();
    const developerToken = row.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const accessToken = await getGoogleAccessToken(row);
    if (!developerToken || !accessToken) {
      results.push({
        platform: "google_ads",
        conversionId: row.conversionId,
        ok: false,
        skipped: true,
        reason: "Google Ads server credentials are not configured",
      });
      continue;
    }
    const customerId = String(row.customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/\D/g, "");
    const conversionActionId = String(row.conversionActionId || process.env.GOOGLE_ADS_CONVERSION_ACTION_ID || "").trim();
    const clickId = getGoogleClickId(payload.userData);
    if (!customerId || !conversionActionId || !clickId) {
      results.push({
        platform: "google_ads",
        conversionId: row.conversionId,
        ok: false,
        skipped: true,
        reason: "Missing customerId, conversionActionId, or Google click id",
      });
      continue;
    }

    const conversion = {
      conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
      conversionDateTime: new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00"),
      conversionValue: Number(payload.customData?.value || 0),
      currencyCode: payload.customData?.currency || "BDT",
      orderId: String(payload.customData?.order_id || payload.eventId),
      ...(payload.userData?.gclid ? { gclid: payload.userData.gclid } : {}),
      ...(payload.userData?.gbraid ? { gbraid: payload.userData.gbraid } : {}),
      ...(payload.userData?.wbraid ? { wbraid: payload.userData.wbraid } : {}),
    };
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };
    const loginCustomerId = String(row.loginCustomerId || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/\D/g, "");
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

    const url = `https://googleads.googleapis.com/v17/customers/${customerId}:uploadClickConversions`;
    results.push({
      platform: "google_ads",
      conversionId: row.conversionId,
      ...(await postJson(url, { conversions: [conversion], partialFailure: true }, headers)),
    });
  }
  return results;
};

const getPublicConfig = async () => {
  const [metaPixels, tiktokPixels, googleAds] = await Promise.all([
    FacebookPixelService.getPublicFromDB(),
    TiktokPixelService.getPublicFromDB(),
    GoogleAdsService.getPublicFromDB(),
  ]);
  return { metaPixels, tiktokPixels, googleAds };
};

const trackEvent = async (payload, req) => {
  const eventName = String(payload.eventName || "").trim();
  if (!eventName) throw new ApiError(400, "eventName is required");
  const eventId = payload.eventId || `${eventName}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const context = {
    ipAddress: getTrackingClientIp(req),
    userAgent: req.headers ? req.headers["user-agent"] : undefined,
  };
  const basePayload = { ...payload, eventName, eventId };
  const [meta, tiktok, googleAds] = await Promise.all([
    sendMeta(basePayload, context).catch((error) => [{ platform: "meta", ok: false, error: error.message }]),
    sendTiktok(basePayload, context).catch((error) => [{ platform: "tiktok", ok: false, error: error.message }]),
    sendGoogleAds(basePayload).catch((error) => [{ platform: "google_ads", ok: false, error: error.message }]),
  ]);
  return { eventId, results: [...meta, ...tiktok, ...googleAds] };
};

module.exports = {
  getPublicConfig,
  trackEvent,
  toMetaEvent,
  normalizeBangladeshPhones,
  parseCustomerName,
  resolveBangladeshCity,
  resolveBangladeshState,
  sanitizeFbc,
  sanitizeFbp,
};