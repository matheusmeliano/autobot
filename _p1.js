const fs = require("fs");
const p = "src/app/api/atendimento/bookings/[bookingId]/attendance/route.ts";
let s = fs.readFileSync(p, "utf8");
s = s
  .replace(/patchLead\.funnel_stage = "repescagem"/g, 'patchLead.funnel_stage = "matricula_pendente_recusada"')
  .replace(/patchLead\.status = "repescagem"/g, 'patchLead.status = "matricula_pendente_recusada"')
  .replace(/nextLeadFunnelStage = "repescagem"/g, 'nextLeadFunnelStage = "matricula_pendente_recusada"')
  .replace(/nextLeadStatus = "repescagem"/g, 'nextLeadStatus = "matricula_pendente_recusada"');
fs.writeFileSync(p, s);
console.log("attendance assignments patched");
