module.exports = (sequelize, DataTypes) => {
  const Order = sequelize.define(
    "Order",
    {
      Id: {
        type: DataTypes.INTEGER(10),
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      orderId: {
        type: DataTypes.STRING(32),
        allowNull: false,
        unique: true,
      },
      checkoutKey: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      customerName: {
        type: DataTypes.STRING(191),
        allowNull: false,
      },
      customerPhone: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      // Last 11 digits of customerPhone, indexed so repeat-customer lookups
      // can use equality instead of a full-table LIKE scan.
      phoneKey: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      ipAddress: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      deviceId: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      customerArea: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      customerDistrict: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      productName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      productImage: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      quantity: {
        type: DataTypes.INTEGER(10),
        allowNull: false,
        defaultValue: 1,
      },
      totalBill: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
      },
      advance: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        defaultValue: 0,
      },
      courier: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      orderSource: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "pending",
      },
      fraudScore: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1,
      },
      fraudStatus: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      fraudReason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      orderDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      assignedEmployeeId: {
        type: DataTypes.INTEGER(10),
        allowNull: true,
      },
      assignedEmployeeName: {
        type: DataTypes.STRING(191),
        allowNull: true,
      },
      assignedById: {
        type: DataTypes.INTEGER(10),
        allowNull: true,
      },
      assignedByName: {
        type: DataTypes.STRING(191),
        allowNull: true,
      },
      assignedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Variant stock currently held by this order: [{ variationId, qty }]
      stockLedger: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      timestamps: true,
      paranoid: true,
      hooks: {
        beforeSave(order) {
          if (order.isNewRecord || order.changed("customerPhone")) {
            order.phoneKey = toOrderPhoneKey(order.customerPhone);
          }
        },
      },
    }
  );

  Order.toPhoneKey = toOrderPhoneKey;

  return Order;
};

function toOrderPhoneKey(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-11);
}
