const VTPASS_BASE_URL =
  process.env.VTPASS_BASE_URL ||
  "https://sandbox.vtpass.com/api";

const API_KEY = process.env.VTPASS_API_KEY;
const PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const SECRET_KEY = process.env.VTPASS_SECRET_KEY;

const checkCredentials = () => {
  if (!API_KEY || !PUBLIC_KEY || !SECRET_KEY) {
    throw new Error(
      "VTpass credentials are not configured."
    );
  }
};

const parseResponse = async (response) => {
  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `VTpass returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.response_description ||
        data?.message ||
        `VTpass request failed (${response.status}).`
    );
  }

  return data;
};

const vtpassGet = async (endpoint) => {
  checkCredentials();

  const response = await fetch(
    `${VTPASS_BASE_URL}${endpoint}`,
    {
      method: "GET",
      headers: {
        "api-key": API_KEY,
        "public-key": PUBLIC_KEY,
        "Content-Type": "application/json",
      },
    }
  );

  return parseResponse(response);
};

const vtpassPost = async (endpoint, body) => {
  checkCredentials();

  const response = await fetch(
    `${VTPASS_BASE_URL}${endpoint}`,
    {
      method: "POST",
      headers: {
        "api-key": API_KEY,
        "secret-key": SECRET_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return parseResponse(response);
};

const getServiceCategories = async () => {
  return vtpassGet("/service-categories");
};

const getServices = async (identifier) => {
  const data = await vtpassGet(
    `/services?identifier=${encodeURIComponent(identifier)}`
  );

  return data;
};

const getVariations = async (serviceID) => {
  return vtpassGet(
    `/service-variations?serviceID=${encodeURIComponent(
      serviceID
    )}`
  );
};

const verifyCustomer = async ({
  serviceID,
  billersCode,
  type,
}) => {
  return vtpassPost("/merchant-verify", {
    serviceID,
    billersCode,
    type,
  });
};

const purchaseService = async (payload) => {
  return vtpassPost("/pay", payload);
};

const requeryTransaction = async (request_id) => {
  return vtpassPost("/requery", {
    request_id,
  });
};

module.exports = {
  getServiceCategories,
  getServices,
  getVariations,
  verifyCustomer,
  purchaseService,
  requeryTransaction,
};