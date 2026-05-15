import { useState, useCallback } from "react";

const EXTRACTION_PROMPT = `You are an expert at extracting customer setup information from email chains for a timber/building materials supplier called SPP (Specialised Panel Products).

Analyse the email chain and extract ALL customer information. Return ONLY a JSON object with no markdown formatting, no backticks, no preamble.

{
  "code_short_name": "string - max 20 chars. Drop 'Ltd', 'Limited', 'The' etc. Use the most recognisable part of the name. E.g. 'The Alloy Project Ltd' becomes 'Alloy Project'. 'Tom Coward' stays as 'Tom Coward'. 'Gateway Construction Services Ltd' becomes 'Gateway Construction'.",
  "display_name": "string - full legal name. Use Ltd not Limited.",
  "address_line1": "string - first line of invoice address (building name or number and street)",
  "address_line2": "string - second line (area/district) or empty string",
  "town": "string - city/town",
  "county": "string - county or empty string",
  "postcode": "string - postcode",
  "contact_name": "string - main contact name",
  "mobile": "string - mobile phone number, normalised with spaces e.g. 07957 387965",
  "landline": "string - landline number or empty string",
  "email": "string - customer email address",
  "website": "string - customer website URL or empty string",
  "delivery_address_line1": "string",
  "delivery_address_line2": "string",
  "delivery_town": "string",
  "delivery_county": "string",
  "delivery_postcode": "string",
  "delivery_contact_name": "string",
  "delivery_contact_number": "string",
  "what3words": "string - just the three words e.g. basket.unique.gives - no slashes",
  "delivery_opening_hours": "string - short, e.g. '08:00-18:00 by appointment' or 'Not confirmed'",
  "forklift_on_site": "string - short, e.g. 'Yes', 'No - manual offload', or 'Not confirmed'",
  "vehicle_access": "string - short summary, e.g. 'Curtain-sider OK, tight residential road' or 'Not confirmed'",
  "delivery_restrictions": "string - short, e.g. 'School street 08:30-09:30, 15:00-16:00' or 'Not confirmed'",
  "sales_rep": "string - the SPP staff member who forwarded the customer setup request internally",
  "products_of_interest": ["array of strings"],
  "suggested_customer_type": "string - pick the BEST match from this exact list based on what the customer does and what they're ordering: Unknown, Joinery & Shopfitting, Architect / Designer / Specifier, Laser - Crafts, Laser - Die Boards, Flightcase Makers, Formwork, Staging, Access Towers, Rail - Rolling Stock, Rail - Infrastructure, Construction, Marquee, Hoarding, Trailers, FR Plywood, Sports & Rebound, Exhibition, Plywood - General, Timber Cladding - Domestic, Timber Cladding - Commercial, Timber - General, Flooring - Exhibition Contractor, Flooring - End User, Flooring - Venue, Flooring - Marquee, Flooring - Experiential Marketing, Manufacturing, Material Handling & Storage, Importer / Merchant, Fencing, Furniture Manufacturer, Small End User - Plywood, Display, Vehicle Builders, Building Interiors - Walls/Floors, Livestock / Agriculture, House Builder, Main Contractor, Sub Contractor, Commission, Decking Installer - Commercial, Decking Installer - Domestic, Set Builders, Scaffold, Flooring, Woodworkers / Processors, Education Sector, Roofing Contractor, Sauna, Cabin & Outdoor Studios, Rail - LUL Contractor, Boat Builders, Kitchen Manufacturers. If unsure, use 'Unknown'.",
  "is_proforma": true,
  "delivery_same_as_invoice": true,
  "delivery_notes_summary": "string - one-liner for copy-paste e.g. '08:00-18:00. No forklift. Curtain-sider OK. School street 08:30-09:30, 15:00-16:00.'",
  "checklist": {
    "full_business_name": true,
    "full_invoice_address": true,
    "invoice_contact_name_and_telephone": true,
    "full_delivery_address": true,
    "what3words": true,
    "delivery_contact_name_and_telephone": true,
    "delivery_opening_hours": true,
    "forklift_on_site": true,
    "vehicle_access": true,
    "delivery_restrictions": true
  },
  "raw_notes": "string - brief context: what they ordered, timing, anything useful. Max 2 sentences."
}

RULES:
- Phone numbers in UK format with spaces
- If delivery = invoice, populate both and set delivery_same_as_invoice true
- Checklist reflects what the CUSTOMER provided, not what you inferred
- Use Ltd not Limited
- code_short_name: max 20 chars, drop Ltd/Limited/The, keep the recognisable core
- Keep all text SHORT. No long paragraphs. Delivery fields should be brief summaries.
- If info wasn't provided, use "Not confirmed" rather than empty string for delivery fields

CRITICAL: Return ONLY the JSON. Start with { and end with }.`;

const VERIFY_PROMPT = `You are verifying contact details for a new customer of a timber supplier. Search the web to verify the email, phone, and company details.

Also assess the delivery address for large vehicle access (curtain-sided lorries carrying heavy sheet materials). Keep observations SHORT - max 4 bullet points.

Return ONLY a JSON object, no markdown, no backticks:
{
  "email_check": {"status": "match" or "unverified" or "mismatch", "note": "max 12 words"},
  "phone_check": {"status": "match" or "unverified" or "mismatch", "note": "max 12 words"},
  "companies_house": {"status": "match" or "unverified" or "not_applicable", "note": "max 12 words"},
  "website_check": {"status": "match" or "unverified" or "not_applicable", "note": "max 12 words"},
  "address_bullets": ["array of 3-4 short bullet strings about delivery access, e.g. 'Residential street - smaller vehicle may be needed', 'Tight corners noted by customer', 'School street restrictions apply'"]
}

CRITICAL: Return ONLY the JSON. Start with { and end with }.`;

/* ── clipboard ── */
function doClip(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;outline:none;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try { document.execCommand("copy"); } catch(e) {}
  document.body.removeChild(ta);
}

/* ── low bridge map link builder ── */
const LOW_BRIDGE_MAP_BASE = "https://www.google.com/maps/d/viewer?mid=17FAITKL83Ozz19QAljbfqcRkmu7PVhL2&femb=1";

async function geocodePostcode(postcode) {
  if (!postcode) return null;
  const clean = postcode.replace(/\s+/g, "");
  try {
    const resp = await fetch(`https://api.postcodes.io/postcodes/${clean}`);
    const json = await resp.json();
    if (json.status === 200 && json.result) {
      return { lat: json.result.latitude, lng: json.result.longitude };
    }
  } catch(e) {}
  return null;
}

export default function CustomerSetupExtractor() {
  const [emailText, setEmailText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [data, setData] = useState(null);
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [copiedId, setCopiedId] = useState(null);
  const [bridgeUrl, setBridgeUrl] = useState(null);

  const callClaude = async (systemPrompt, userContent, useSearch = false) => {
    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    };
    if (useSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search" }];
    }
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (json.error) throw new Error(json.error.message || "API error");
    const textBlocks = (json.content || []).filter((b) => b.type === "text").map((b) => b.text);
    const raw = textBlocks.join("\n").replace(/```json|```/g, "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    return JSON.parse(jsonMatch[0]);
  };

  const handleExtract = useCallback(async () => {
    if (!emailText.trim()) return;
    setError(null); setData(null); setVerification(null);
    setExtracting(true); setStep(1);
    try {
      const extracted = await callClaude(EXTRACTION_PROMPT, emailText);
      setData(extracted); setStep(2);
      // Geocode delivery postcode for low bridge link
      setBridgeUrl(null);
      const pc = extracted.delivery_postcode || extracted.postcode;
      if (pc) {
        geocodePostcode(pc).then(coords => {
          if (coords) setBridgeUrl(`${LOW_BRIDGE_MAP_BASE}&ll=${coords.lat}%2C${coords.lng}&z=15`);
        });
      }
      try {
        const vResult = await callClaude(
          VERIFY_PROMPT,
          `Customer: ${extracted.display_name}\nEmail: ${extracted.email}\nPhone: ${extracted.mobile}\nAddress: ${extracted.address_line1}, ${extracted.postcode}\nWebsite: ${extracted.website || "N/A"}\nDelivery address: ${extracted.delivery_address_line1}, ${extracted.delivery_postcode}\nCustomer access notes: ${extracted.vehicle_access || "None"}\nCustomer restrictions: ${extracted.delivery_restrictions || "None"}`,
          true
        );
        setVerification(vResult);
      } catch (e) {
        setVerification({
          email_check: { status: "unverified", note: "Check unavailable" },
          phone_check: { status: "unverified", note: "Check unavailable" },
          companies_house: { status: "unverified", note: e.message },
          website_check: { status: "unverified", note: "" },
          address_bullets: ["Verification unavailable"]
        });
      }
      setStep(3);
    } catch (e) {
      setError(e.message); setStep(0);
    }
    setExtracting(false);
  }, [emailText]);

  const handleClear = () => { setEmailText(""); setData(null); setVerification(null); setError(null); setStep(0); setBridgeUrl(null); };

  const cpy = (text, id) => {
    doClip(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  };

  const buildRepEmail = () => {
    if (!data) return "";
    const CL = {
      full_business_name: "Full business name",
      full_invoice_address: "Full invoice address",
      invoice_contact_name_and_telephone: "Invoice contact name and telephone",
      full_delivery_address: "Full delivery address",
      what3words: "What3Words delivery address",
      delivery_contact_name_and_telephone: "Delivery contact name and telephone",
      delivery_opening_hours: "Delivery address opening hours",
      forklift_on_site: "Is there a forklift on site?",
      vehicle_access: "Is there access for large/curtain-sided vehicles?",
      delivery_restrictions: "Any delivery restrictions?",
    };
    const missingItems = Object.entries(CL).filter(([k]) => !data.checklist?.[k]);
    if (missingItems.length === 0) return "";
    const rep = data.sales_rep || "team";
    const custName = data.display_name || "the customer";
    const bullets = missingItems.map(([, label]) => `\u2022 ${label}`).join("\n");
    return `Hi ${rep},\n\nCould you get the following from ${custName} please?\n\n${bullets}\n\nThanks`;
  };

  const Row = ({ label, value, id, isLink }) => {
    const empty = !value || value.trim() === "" || value === "Not confirmed";
    const dimmed = value === "Not confirmed";
    return (
      <div className="row">
        <span className="rl">{label}</span>
        {isLink && value && !empty ? (
          <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noopener noreferrer"
            className="fv fv-link" data-fid={id}>{value}</a>
        ) : (
          <span className={`fv${empty && !dimmed ? " na" : ""}${dimmed ? " dim" : ""}`} data-fid={id}
            onClick={() => {
              if (empty && !dimmed) return;
              const el = document.querySelector(`[data-fid="${id}"]`);
              if (!el) return;
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
            }}>
            {empty && !dimmed ? "\u2014" : value}
          </span>
        )}
        {!empty && !dimmed && (
          <button className={`cbtn${copiedId === id ? " copied" : ""}`} onClick={() => cpy(value, id)}>
            {copiedId === id ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    );
  };

  const CL_LABELS = {
    full_business_name: "Full business name",
    full_invoice_address: "Full invoice address",
    invoice_contact_name_and_telephone: "Invoice contact & telephone",
    full_delivery_address: "Full delivery address",
    what3words: "What3Words address",
    delivery_contact_name_and_telephone: "Delivery contact & telephone",
    delivery_opening_hours: "Delivery opening hours",
    forklift_on_site: "Forklift on site",
    vehicle_access: "Vehicle access",
    delivery_restrictions: "Delivery restrictions",
  };

  const provided = data ? Object.entries(CL_LABELS).filter(([k]) => data.checklist?.[k]) : [];
  const missing = data ? Object.entries(CL_LABELS).filter(([k]) => !data.checklist?.[k]) : [];

  const vChecks = verification ? [
    { label: "Email", ...verification.email_check },
    { label: "Phone", ...verification.phone_check },
    { label: "Companies House", ...verification.companies_house },
    { label: "Website", ...verification.website_check },
  ] : [];
  const vMatch = vChecks.filter(c => c.status === "match");
  const vOther = vChecks.filter(c => c.status !== "match");

  const stepLabels = ["", "Extracting...", "Verifying...", "Complete"];

  return (
    <>
      <style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
.app-wrap { font-family:'DM Sans',sans-serif; color:#2c2c2c; min-height:100vh; background:#f4f5f2; }
.app-header { padding:16px 24px; border-bottom:1px solid #e5e7eb; background:#fff; display:flex; align-items:center; gap:12px; }
.app-header h1 { font-size:17px; font-weight:700; letter-spacing:0.2px; color:#2c2c2c; }
.app-header .sub { font-size:12px; color:#5c6a3a; letter-spacing:0.5px; text-transform:uppercase; font-weight:600; }
.input-area { max-width:920px; margin:24px auto; padding:0 20px; }
.input-area textarea { width:100%; min-height:130px; max-height:340px; resize:vertical; padding:14px; border:1px solid #dde0d5; border-radius:10px; background:#fff; color:#2c2c2c; font-family:'JetBrains Mono',monospace; font-size:13px; line-height:1.6; outline:none; }
.input-area textarea:focus { border-color:#5c6a3a; }
.btn-row { display:flex; gap:10px; margin-top:12px; }
.btn-primary { background:#5c6a3a; color:#fff; border:none; border-radius:8px; padding:11px 26px; font-size:14px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; }
.btn-primary:hover { background:#4e5a31; }
.btn-primary:disabled { opacity:0.4; cursor:wait; }
.btn-secondary { background:transparent; color:#6b7280; border:1px solid #dde0d5; border-radius:8px; padding:11px 20px; font-size:14px; cursor:pointer; font-family:'DM Sans',sans-serif; }
.results { max-width:920px; margin:0 auto; padding:0 20px 40px; }
.cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; }
.card { background:#fff; border-radius:12px; border:1px solid #dde0d5; padding:18px 20px; margin-bottom:16px; }
.card-title { font-size:12px; font-weight:600; color:#6b7280; letter-spacing:0.5px; margin:0 0 12px 0; padding-bottom:8px; border-bottom:1px solid #eef0ea; text-transform:uppercase; display:flex; align-items:center; gap:8px; }
.row { display:flex; align-items:center; padding:5px 0; border-bottom:0.5px solid #f3f4f1; min-height:36px; }
.rl { font-size:13px; color:#6b7280; width:125px; flex-shrink:0; }
.fv { font-size:14px; color:#2c2c2c; flex:1; user-select:all; -webkit-user-select:all; cursor:pointer; padding:2px 6px; border-radius:4px; word-break:break-word; }
.fv:hover { background:#f7f8f5; }
.fv.na { color:#c0c0c8; font-style:italic; cursor:default; }
.fv.na:hover { background:transparent; }
.fv.dim { color:#9ca3af; font-style:italic; }
.fv-link { font-size:14px; color:#5c6a3a; flex:1; padding:2px 6px; border-radius:4px; text-decoration:none; word-break:break-word; font-weight:500; }
.fv-link:hover { background:#f0f3eb; text-decoration:underline; }
.cbtn { font-size:13px; color:#6b7280; background:#f7f8f5; border:1px solid #dde0d5; border-radius:6px; padding:5px 16px; cursor:pointer; flex-shrink:0; margin-left:8px; transition:all 0.12s; font-family:'DM Sans',sans-serif; font-weight:500; }
.cbtn:hover { background:#eef0ea; color:#2c2c2c; }
.cbtn.copied { background:#e8f5e9; color:#2d6a4f; border-color:#c8e6c9; }
.cr { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:14px; }
.cr-label { flex:1; color:#2c2c2c; }
.bg { display:inline-block; font-size:12px; font-weight:500; padding:3px 10px; border-radius:6px; white-space:nowrap; flex-shrink:0; }
.bg-ok { background:#e8f5e9; color:#2d6a4f; }
.bg-no { background:#ffeaea; color:#c1292e; }
.bg-wn { background:#fff8e1; color:#92400e; }
.del-sum { font-size:13px; padding:10px 14px; background:#f7f8f5; border-radius:8px; cursor:pointer; user-select:all; margin-top:10px; line-height:1.5; }
.del-sum:hover { background:#eef0ea; }
.prod-tag { display:inline-block; font-size:12px; padding:3px 10px; border-radius:6px; background:#eef3e6; color:#5c6a3a; margin-right:4px; margin-bottom:4px; }
.note-badge { font-size:11px; font-weight:600; padding:3px 10px; border-radius:6px; background:#fff8e1; color:#92400e; margin-left:auto; }
.step-dots { display:flex; align-items:center; gap:6px; margin-left:auto; }
.step-dot { width:9px; height:9px; border-radius:50%; background:#dde0d5; transition:all 0.3s; }
.step-dot.active { background:#5c6a3a; }
.step-dot.done { background:#2d6a4f; }
.step-label { font-size:12px; color:#9ca3af; margin-left:6px; }
.error-box { background:#ffeaea; border:1px solid #c1292e; border-radius:10px; padding:14px 18px; margin-bottom:16px; font-size:14px; color:#c1292e; }
.action-btn { display:flex; align-items:center; gap:8px; margin-top:12px; padding:10px 18px; background:#5c6a3a; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; width:100%; justify-content:center; }
.action-btn:hover { background:#4e5a31; }
.action-btn.copied { background:#2d6a4f; }
.link-btn { display:inline-flex; align-items:center; gap:6px; margin-top:10px; padding:8px 14px; background:#f7f8f5; color:#5c6a3a; border:1px solid #dde0d5; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; font-family:'DM Sans',sans-serif; text-decoration:none; }
.link-btn:hover { background:#eef3e6; border-color:#b8c4a0; }
.bullet { font-size:13px; color:#4b5563; padding:3px 0 3px 16px; position:relative; line-height:1.5; }
.bullet::before { content:'\\2022'; position:absolute; left:2px; color:#5c6a3a; }
.v-row { display:flex; align-items:flex-start; gap:8px; padding:5px 0; font-size:14px; border-bottom:0.5px solid #f3f4f1; }
.v-row:last-of-type { border-bottom:none; }
.v-label { font-weight:500; color:#2c2c2c; min-width:100px; flex-shrink:0; }
.v-note { color:#6b7280; flex:1; font-size:13px; }
.same-note { font-size:12px; color:#9ca3af; font-style:italic; padding:2px 0 6px; }
      `}</style>

      <div className="app-wrap">
        <div className="app-header">
          <div>
            <div className="sub">SPP</div>
            <h1>Customer Setup Extractor</h1>
          </div>
          {step > 0 && (
            <div className="step-dots">
              {[1,2,3].map(s => (
                <div key={s} className={`step-dot${step > s ? " done" : step === s ? " active" : ""}`} />
              ))}
              <span className="step-label">{stepLabels[step]}</span>
            </div>
          )}
        </div>

        <div className="input-area">
          <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)} placeholder="Paste the email chain here..." />
          <div className="btn-row">
            <button className="btn-primary" onClick={handleExtract} disabled={extracting || !emailText.trim()}>
              {extracting ? "Extracting..." : "Extract & Verify"}
            </button>
            {data && <button className="btn-secondary" onClick={handleClear}>Clear</button>}
          </div>
        </div>

        {error && <div className="results"><div className="error-box">{error}</div></div>}

        {data && (
          <div className="results">
            <div className="cols">

              {/* ===== LEFT COLUMN ===== */}
              <div>
                {/* Customer / Invoice card */}
                <div className="card">
                  <p className="card-title">
                    Customer / Invoice details
                    {data.is_proforma && <span className="note-badge">Proforma / Cash</span>}
                  </p>
                  {(data.sales_rep || data.suggested_customer_type) && (
                    <div style={{ display:"flex", gap:12, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
                      {data.sales_rep && <span style={{ fontSize:12, color:"#6b7280" }}>Rep: <strong style={{ color:"#2c2c2c" }}>{data.sales_rep}</strong></span>}
                      {data.sales_rep && data.suggested_customer_type && <span style={{ color:"#dde0d5" }}>|</span>}
                      {data.suggested_customer_type && <span style={{ fontSize:12, color:"#6b7280" }}>Suggested type: <strong style={{ color:"#2c2c2c" }}>{data.suggested_customer_type}</strong></span>}
                    </div>
                  )}
                  <Row label="Code / short name" value={data.code_short_name} id="code" />
                  <Row label="Display name" value={data.display_name} id="display" />
                  <Row label="Address line 1" value={data.address_line1} id="addr1" />
                  <Row label="Address line 2" value={data.address_line2} id="addr2" />
                  <Row label="Town" value={data.town} id="town" />
                  <Row label="County" value={data.county} id="county" />
                  <Row label="Postcode" value={data.postcode} id="postcode" />
                  <Row label="Contact name" value={data.contact_name} id="contact" />
                  <Row label="Mobile" value={data.mobile} id="mobile" />
                  {data.landline && <Row label="Landline" value={data.landline} id="landline" />}
                  <Row label="Email" value={data.email} id="email" />
                  {data.website && <Row label="Website" value={data.website} id="website" isLink />}
                </div>

                {/* Delivery card */}
                <div className="card">
                  <p className="card-title">Delivery details</p>
                  {data.delivery_same_as_invoice && <div className="same-note">Delivery address same as invoice</div>}
                  <Row label="Address line 1" value={data.delivery_address_line1} id="daddr1" />
                  <Row label="Address line 2" value={data.delivery_address_line2} id="daddr2" />
                  <Row label="Town" value={data.delivery_town} id="dtown" />
                  <Row label="County" value={data.delivery_county} id="dcounty" />
                  <Row label="Postcode" value={data.delivery_postcode} id="dpostcode" />
                  <Row label="Contact" value={data.delivery_contact_name} id="dcontact" />
                  <Row label="Phone" value={data.delivery_contact_number} id="dphone" />
                  <Row label="Opening hours" value={data.delivery_opening_hours} id="hours" />
                  <Row label="Forklift" value={data.forklift_on_site} id="fork" />
                  <Row label="Vehicle access" value={data.vehicle_access} id="vehicle" />
                  <Row label="Restrictions" value={data.delivery_restrictions} id="restrict" />

                  {data.delivery_notes_summary && (
                    <div className="del-sum" onClick={() => cpy(data.delivery_notes_summary, "dsum")} title="Click to copy">
                      {copiedId === "dsum" ? "Copied!" : data.delivery_notes_summary}
                    </div>
                  )}
                </div>

                {/* What3Words card */}
                <div className="card">
                  <p className="card-title">What3Words</p>
                  <Row label="Address" value={data.what3words} id="w3w" />
                </div>

                {/* Products card */}
                {data.products_of_interest && data.products_of_interest.length > 0 && (
                  <div className="card">
                    <p className="card-title">Products of interest</p>
                    <div style={{ padding:"2px 0" }}>
                      {data.products_of_interest.map((p, i) => <span key={i} className="prod-tag">{p}</span>)}
                    </div>
                  </div>
                )}
              </div>

              {/* ===== RIGHT COLUMN ===== */}
              <div>
                {/* Checklist card */}
                <div className="card">
                  <p className="card-title">Information checklist</p>
                  {provided.map(([k, label]) => (
                    <div key={k} className="cr">
                      <span className="cr-label">{label}</span>
                      <span className="bg bg-ok">Provided</span>
                    </div>
                  ))}
                  {missing.length > 0 && provided.length > 0 && <div style={{ height:8 }} />}
                  {missing.map(([k, label]) => (
                    <div key={k} className="cr">
                      <span className="cr-label">{label}</span>
                      <span className="bg bg-no">Missing</span>
                    </div>
                  ))}
                  {missing.length > 0 && (
                    <button
                      className={`action-btn${copiedId === "rep-email" ? " copied" : ""}`}
                      onClick={() => cpy(buildRepEmail(), "rep-email")}
                    >
                      {copiedId === "rep-email" ? "Copied to clipboard!" : `Copy missing info email for ${data.sales_rep || "rep"}`}
                    </button>
                  )}
                </div>

                {/* Verification card */}
                <div className="card">
                  <p className="card-title">Verification</p>
                  {!verification && <div style={{ fontSize:13, color:"#9ca3af" }}>Searching...</div>}
                  {verification && (
                    <>
                      {vMatch.map((c, i) => (
                        <div key={`m${i}`} className="v-row">
                          <span className="v-label">{c.label}</span>
                          <span className="v-note">{c.note}</span>
                          <span className="bg bg-ok">Match</span>
                        </div>
                      ))}
                      {vOther.length > 0 && vMatch.length > 0 && <div style={{ height:4 }} />}
                      {vOther.map((c, i) => (
                        <div key={`o${i}`} className="v-row">
                          <span className="v-label">{c.label}</span>
                          <span className="v-note">{c.note}</span>
                          <span className={`bg ${c.status === "mismatch" ? "bg-no" : "bg-wn"}`}>
                            {c.status === "mismatch" ? "Mismatch" : "Unverified"}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Delivery address notes card */}
                <div className="card">
                  <p className="card-title">Delivery address notes</p>
                  {verification?.address_bullets && verification.address_bullets.length > 0 ? (
                    verification.address_bullets.map((b, i) => (
                      <div key={i} className="bullet">{b}</div>
                    ))
                  ) : (
                    <div style={{ fontSize:13, color:"#9ca3af" }}>{verification ? "No specific concerns noted" : "Checking..."}</div>
                  )}
                  {data.delivery_postcode && (
                    bridgeUrl ? (
                      <a
                        href={bridgeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Check low bridges near {data.delivery_postcode}
                      </a>
                    ) : (
                      <div className="link-btn" style={{ color:"#9ca3af", cursor:"default", borderColor:"#e5e7eb" }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Loading bridge map...
                      </div>
                    )
                  )}
                </div>

                {/* Notes card */}
                {data.raw_notes && (
                  <div className="card">
                    <p className="card-title">Notes</p>
                    <div style={{ fontSize:13, color:"#4b5563", lineHeight:1.6 }}>
                      {data.raw_notes}
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}
