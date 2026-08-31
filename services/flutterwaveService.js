const FLW_BASE_URL =
  process.env.FLW_BASE_URL ||
  "https://developersandbox-api.flutterwave.com";

const CLIENT_ID = process.env.FLW_CLIENT_ID;
const CLIENT_SECRET = process.env.FLW_CLIENT_SECRET;

const TOKEN_URL =
  "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";

let cachedToken = null;
let tokenExpiresAt = 0;


// =========================================================
// CREDENTIAL CHECK
// =========================================================

const checkCredentials = () => {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Flutterwave credentials are not configured."
    );
  }
};


// =========================================================
// GENERATE TRACE ID
// =========================================================

const generateTraceId = () => {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 14)}`;
};


// =========================================================
// GET ACCESS TOKEN
// =========================================================

const getAccessToken = async () => {
  checkCredentials();

  if (
    cachedToken &&
    Date.now() < tokenExpiresAt
  ) {
    return cachedToken;
  }

  const body =
    new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    });

  const response = await fetch(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Flutterwave authentication returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error_description ||
        data?.message ||
        "Flutterwave authentication failed."
    );
  }

  if (!data?.access_token) {
    throw new Error(
      "Flutterwave did not return an access token."
    );
  }

  cachedToken = data.access_token;

  const expiresIn =
    Number(data.expires_in) || 3600;

  tokenExpiresAt =
    Date.now() +
    Math.max(expiresIn - 60, 60) * 1000;

  return cachedToken;
};


// =========================================================
// GENERIC FLUTTERWAVE REQUEST
// =========================================================

const flutterwaveRequest = async (
  endpoint,
  options = {}
) => {
  const token =
    await getAccessToken();

  const response = await fetch(
    `${FLW_BASE_URL}${endpoint}`,
    {
      ...options,

      headers: {
        Accept: "application/json",
        "Content-Type":
          "application/json",

        Authorization:
          `Bearer ${token}`,

        "X-Trace-Id":
          options.traceId ||
          generateTraceId(),

        ...(options.headers || {}),
      },
    }
  );

  const text =
    await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Flutterwave returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error?.message ||
        data?.error_description ||
        `Flutterwave request failed (${response.status}).`
    );
  }

  return data;
};


// =========================================================
// GET NIGERIAN BANKS
// =========================================================

const getBanks = async () => {
  return flutterwaveRequest(
    "/banks?country=NG"
  );
};


// =========================================================
// VERIFY BANK ACCOUNT
// =========================================================

const verifyBankAccount = async ({
  accountNumber,
  bankCode,
}) => {
  if (!/^\d{10}$/.test(accountNumber || "")) {
    throw new Error(
      "Account number must contain exactly 10 digits."
    );
  }

  if (!bankCode) {
    throw new Error(
      "Bank code is required."
    );
  }

  return flutterwaveRequest(
    "/banks/account-resolve",
    {
      method: "POST",

      body: JSON.stringify({
        account: {
          code: String(bankCode),
          number: accountNumber,
        },

        currency: "NGN",
      }),
    }
  );
};


// =========================================================
// CREATE NIGERIAN BANK TRANSFER
// =========================================================

const createTransfer = async ({
  amount,
  accountNumber,
  bankCode,
  narration,
  reference,
}) => {
  const transferAmount = Number(amount);

  if (
    !Number.isFinite(transferAmount) ||
    transferAmount <= 0
  ) {
    throw new Error(
      "A valid transfer amount is required."
    );
  }

  if (!/^\d{10}$/.test(accountNumber || "")) {
    throw new Error(
      "Account number must contain exactly 10 digits."
    );
  }

  if (!bankCode) {
    throw new Error(
      "Bank code is required."
    );
  }

  if (!reference) {
    throw new Error(
      "Transfer reference is required."
    );
  }

  return flutterwaveRequest(
    "/direct-transfers",
    {
      method: "POST",

      body: JSON.stringify({
        action: "instant",

        type: "bank",

        reference,

        narration:
          narration ||
          "BloomVest transfer",

        payment_instruction: {
          source_currency: "NGN",

          amount: {
            applies_to:
              "destination_currency",

            value: transferAmount,
          },

          recipient: {
            bank: {
              account_number:
                accountNumber,

              code:
                String(bankCode),
            },
          },

          destination_currency: "NGN",
        },
      }),
    }
  );
};


// =========================================================
// GET TRANSFER
// =========================================================

const getTransfer = async (
  transferId
) => {
  if (!transferId) {
    throw new Error(
      "Transfer ID is required."
    );
  }

  return flutterwaveRequest(
    `/transfers/${encodeURIComponent(
      transferId
    )}`
  );
};


// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  getAccessToken,
  getBanks,
  verifyBankAccount,
  createTransfer,
  getTransfer,
};