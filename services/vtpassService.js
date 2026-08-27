const VTPASS_BASE_URL =
  process.env.VTPASS_BASE_URL || "https://sandbox.vtpass.com/api";

const API_KEY = process.env.VTPASS_API_KEY;
const PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const SECRET_KEY = process.env.VTPASS_SECRET_KEY;

const checkCredentials = () => {
  if (!API_KEY || !PUBLIC_KEY || !SECRET_KEY) {
    throw new Error("VTpass credentials are not configured.");
  }
};

const vtpassGet = async (endpoint) => {
  checkCredentials();

  const response = await fetch(`${VTPASS_BASE_URL}${endpoint}`, {
    method: "GET",
    headers: {
      "api-key": API_KEY,
      "public-key": PUBLIC_KEY,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.response_description ||
        data?.message ||
        "VTpass request failed"
    );
  }

  return data;
};

const vtpassPost = async (endpoint, body) => {
  checkCredentials();

  const response = await fetch(`${VTPASS_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "api-key": API_KEY,
      "secret-key": SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.response_description ||
        data?.message ||
        "VTpass request failed"
    );
  }

  return data;
};

const getServiceCategories = async () => {
  return vtpassGet("/service-categories");
};

const getServices = async (identifier) => {
  return vtpassGet(
    `/services?identifier=${encodeURIComponent(identifier)}`
  );
};

const getVariations = async (serviceID) => {
  return vtpassGet(
    `/service-variations?serviceID=${encodeURIComponent(serviceID)}`
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