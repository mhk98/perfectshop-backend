module.exports = (sequelize, DataTypes) => {
  const ScratchCard = sequelize.define(
    "ScratchCard",
    {
      Id:       { type: DataTypes.INTEGER(10), primaryKey: true, autoIncrement: true, allowNull: false },
      // Customer-facing reference such as "SC-7K4Q9P"; see scratchCard.reference.js.
      referenceCode: { type: DataTypes.STRING(16), allowNull: true },
      fullName: { type: DataTypes.STRING(128), allowNull: false },
      phone:    { type: DataTypes.STRING(32),  allowNull: false },
      address:  { type: DataTypes.TEXT,        allowNull: false },
      image:    { type: DataTypes.STRING,      allowNull: false },
      prize:    { type: DataTypes.STRING(64),  allowNull: false },
      status:   { type: DataTypes.STRING(32),  allowNull: false, defaultValue: "Pending" },
      claimType:{ type: DataTypes.STRING(16),  allowNull: false, defaultValue: "first" },
      note:     { type: DataTypes.TEXT,        allowNull: true },
      // Set when the claim is approved; the admin panel filters by it.
      approvedAt:{ type: DataTypes.DATE,       allowNull: true },
      // Agent (user with the "Agent" role) who handles this claim; they see only their own.
      assignedAgentId:   { type: DataTypes.INTEGER(10), allowNull: true },
      assignedAgentName: { type: DataTypes.STRING(191), allowNull: true },
      assignedById:      { type: DataTypes.INTEGER(10), allowNull: true },
      assignedAt:        { type: DataTypes.DATE,        allowNull: true },
      // Prize delivery through Steadfast/Pathao; see scratchCard.courier.js.
      courier:        { type: DataTypes.STRING(32), allowNull: true },
      consignmentId:  { type: DataTypes.STRING(64), allowNull: true },
      trackingCode:   { type: DataTypes.STRING(64), allowNull: true },
      courierStatus:  { type: DataTypes.STRING(64), allowNull: true },
      courierFinal:   { type: DataTypes.BOOLEAN,    allowNull: false, defaultValue: false },
      courierSentAt:  { type: DataTypes.DATE,       allowNull: true },
      // "inside"/"outside" Dhaka set by an admin; null = guessed from the address.
      deliveryArea:   { type: DataTypes.STRING(16), allowNull: true },
      // Delivery charge the courier collects from the customer, fixed when sent.
      codAmount:      { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      deletedAt:{ type: DataTypes.DATE,        allowNull: true },
    },
    // The unique index on referenceCode is added by ensureScratchCardColumns
    // (models/index.js) once the column exists; declaring it here makes sync()
    // try to index the column before it has been added to an existing table.
    { timestamps: true, paranoid: true }
  );
  return ScratchCard;
};
