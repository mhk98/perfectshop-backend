// Statuses set by hand. After an Approved card is sent to Steadfast/Pathao its
// status is the courier's own (see scratchCard.courier.js).
const SCRATCH_CARD_STATUSES = ["Pending", "Approved", "Rejected", "Not Responding"];

// "first" = the phone's first claim; "repeat" = a further card from a phone
// that already claimed, kept separate so management can verify it.
const SCRATCH_CARD_CLAIM_TYPES = ["first", "repeat"];

module.exports = { SCRATCH_CARD_STATUSES, SCRATCH_CARD_CLAIM_TYPES };
