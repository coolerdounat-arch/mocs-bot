const { getConfigValue } = require('../services/configuration');

const QP_SHEET_ID = getConfigValue('qp_sheet_id');
const FSA_SHEET_ID = getConfigValue('fsa_sheet_id');

const SHEET_RANGES = Object.freeze({
  mocsCoverWeekStart: {
    spreadsheetId: QP_SHEET_ID,
    range: "'MoCS Cover'!E26",
  },
  departments: Object.freeze({
    fsd: Object.freeze({
      spreadsheetId: QP_SHEET_ID,
      entries: "'FSD Database'!F19:L1000",
      notice: "'FSD Database'!L19:L1000",
      admins: "'FSD Database'!F8:F9",
      qpIndex: 2,
      noticeIndex: 6,
    }),
    ced: Object.freeze({
      spreadsheetId: QP_SHEET_ID,
      entries: "'CED Database'!F16:N1000",
      notice: "'CED Database'!N16:N1000",
      admins: "'CED Database'!F7:F8",
      qpIndex: 2,
      noticeIndex: 8,
    }),
    ia: Object.freeze({
      spreadsheetId: QP_SHEET_ID,
      entries: "'IA Database'!G15:M1000",
      notice: "'IA Database'!L15:L1000",
      admins: "'IA Database'!G6:G7",
      qpIndex: 2,
      noticeIndex: 5,
    }),
    fsa: Object.freeze({
      spreadsheetId: FSA_SHEET_ID,
      entries: "'FSA Database'!E20:G1000",
      admins: "'FSA Database'!E12:E14",
      novice: "'FSA Novice Database'!E6:E1000",
      qpIndex: 2,
    }),
  }),
});

module.exports = { SHEET_RANGES };