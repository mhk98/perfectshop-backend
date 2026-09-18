const bcrypt = require("bcryptjs");
const ApiError = require("../../../error/ApiError");
const { generateToken } = require("../../../helpers/jwtHelpers");
const db = require("../../../models");
const OrderService = require("../order/order.service");

const User = db.user;

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "").trim();

const toCustomer = (user) => ({
  Id: user.Id,
  name: [user.FirstName, user.LastName].filter(Boolean).join(" ").trim() || user.FirstName || "Customer",
  phone: user.Phone,
});

const register = async ({ name, phone, password }) => {
  const normalizedPhone = normalizePhone(phone);
  if (!name || !normalizedPhone || !password) {
    throw new ApiError(400, "Name, phone and password are required");
  }
  if (password.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters");
  }

  const existing = await User.findOne({
    where: { Phone: normalizedPhone },
  });
  if (existing) throw new ApiError(409, "Customer already exists");

  const nameParts = String(name).trim().split(/\s+/);
  const firstName = nameParts.shift() || name;
  const lastName = nameParts.join(" ");

  const user = await User.create({
    FirstName: firstName,
    LastName: lastName || null,
    Email: null,
    Phone: normalizedPhone,
    Password: password,
    role: "user",
    status: "Active",
  });

  return toCustomer(user);
};

const login = async ({ phone, password }) => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone || !password) {
    throw new ApiError(400, "Phone and password are required");
  }

  const user = await User.findOne({
    where: { Phone: normalizedPhone },
  });
  if (!user) throw new ApiError(401, "Invalid phone or password");
  if (user.status === "Inactive") throw new ApiError(403, "This account is deactivated");

  const valid = await bcrypt.compare(password, user.Password);
  if (!valid) throw new ApiError(401, "Invalid phone or password");

  const token = generateToken(user, { customer: true });
  return { token, customer: toCustomer(user) };
};

const getOrders = async (user) => {
  const phone = normalizePhone(user?.Phone || user?.phone);
  if (!phone) return [];
  return OrderService.trackOrdersByPhoneFromDB(phone);
};

const changePassword = async (user, { oldPassword, newPassword }) => {
  if (!oldPassword || !newPassword) {
    throw new ApiError(400, "Old password and new password are required");
  }
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters");
  }

  const row = await User.findOne({ where: { Id: user.Id } });
  if (!row) throw new ApiError(404, "Customer not found");

  const valid = await bcrypt.compare(oldPassword, row.Password);
  if (!valid) throw new ApiError(400, "Old password is incorrect");

  await row.update({ Password: newPassword });
  return { changed: true };
};

module.exports = { register, login, getOrders, changePassword };
