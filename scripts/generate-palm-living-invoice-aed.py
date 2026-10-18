import subprocess
import os

HTML_CONTENT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice WOD-INV-2026-111</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body {
    margin: 0;
    padding: 0;
    width: 210mm;
    height: 297mm;
    max-height: 297mm;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
    background: #ffffff;
    position: relative;
    overflow: hidden;
    font-size: 11px;
    line-height: 1.45;
    -webkit-font-smoothing: antialiased;
  }
  .page-container {
    padding: 34px 44px 26px 44px;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    position: relative;
    z-index: 2;
  }

  /* Watermark */
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    height: 400px;
    opacity: 0.035;
    z-index: 1;
    pointer-events: none;
  }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
  }
  .logo-block {
    display: flex;
    flex-direction: column;
  }
  .brand-logo {
    width: 175px;
    height: auto;
    margin-bottom: 5px;
  }
  .by-entity {
    font-size: 10.5px;
    color: #4b5563;
    font-weight: 400;
  }
  .invoice-meta-block {
    text-align: right;
  }
  .invoice-title {
    font-size: 32px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 8px 0;
    letter-spacing: -0.6px;
    line-height: 1;
  }
  .meta-table {
    margin-left: auto;
    border-collapse: collapse;
  }
  .meta-table td {
    padding: 2px 0;
    font-size: 10.5px;
  }
  .meta-table td.label {
    color: #6b7280;
    padding-right: 18px;
    text-align: right;
    font-weight: 400;
  }
  .meta-table td.val {
    font-weight: 600;
    color: #111827;
    text-align: right;
  }

  /* Divider */
  .divider {
    border-top: 1px solid #e5e7eb;
    margin: 11px 0;
  }

  /* From / Bill To */
  .parties-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 15px;
  }
  .party-col {
    width: 48%;
  }
  .section-label {
    font-size: 9.5px;
    font-weight: 700;
    color: #6b7280;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .party-name {
    font-size: 11.5px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 2px;
  }
  .party-sub {
    font-size: 11px;
    font-weight: 600;
    color: #374151;
    margin-bottom: 2px;
  }
  .party-address {
    font-size: 10.5px;
    color: #4b5563;
    line-height: 1.45;
  }

  /* Items Table */
  .items-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 2px;
    margin-bottom: 10px;
  }
  .items-table th {
    font-size: 9.5px;
    font-weight: 700;
    color: #6b7280;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 7px 4px;
    border-bottom: 1px solid #d1d5db;
    border-top: 1px solid #e5e7eb;
  }
  .items-table td {
    padding: 8px 4px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: top;
  }
  .col-num { width: 4%; text-align: left; font-weight: 600; color: #6b7280; font-size: 11px; }
  .col-desc { width: 54%; text-align: left; }
  .col-qty { width: 10%; text-align: center; font-size: 11px; color: #111827; }
  .col-unit { width: 16%; text-align: right; font-size: 11px; color: #111827; }
  .col-amount { width: 16%; text-align: right; font-size: 11px; font-weight: 600; color: #111827; }

  .item-title {
    font-size: 11.5px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 2px;
  }
  .item-desc {
    font-size: 10px;
    color: #6b7280;
    line-height: 1.35;
  }

  /* Summary / Totals */
  .summary-container {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
  }
  .summary-table {
    width: 385px;
    border-collapse: collapse;
  }
  .summary-table td {
    padding: 3px 6px;
    font-size: 10.5px;
  }
  .summary-table td.s-label {
    text-align: right;
    color: #4b5563;
  }
  .summary-table td.s-val {
    text-align: right;
    color: #111827;
    font-weight: 600;
    width: 130px;
  }
  .summary-table tr.total-contract-row td {
    padding-top: 5px;
    padding-bottom: 5px;
    border-top: 1px solid #e5e7eb;
    font-size: 11.5px;
    font-weight: 700;
    color: #111827;
  }
  .summary-table tr.advance-due-row td {
    padding: 7px 10px;
    background: #ecfdf5;
    border-top: 1px solid #a7f3d0;
    border-bottom: 1px solid #a7f3d0;
    font-size: 11.5px;
    font-weight: 800;
    color: #065f46;
    white-space: nowrap;
  }
  .summary-table tr.advance-due-row td:first-child {
    border-left: 1px solid #a7f3d0;
    border-top-left-radius: 5px;
    border-bottom-left-radius: 5px;
  }
  .summary-table tr.advance-due-row td:last-child {
    border-right: 1px solid #a7f3d0;
    border-top-right-radius: 5px;
    border-bottom-right-radius: 5px;
    font-size: 12.5px;
  }
  .summary-table tr.balance-row td {
    font-size: 10.5px;
    color: #4b5563;
    padding-top: 5px;
  }

  /* Info Grid */
  .info-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
  }
  .info-col-left {
    width: 52%;
  }
  .info-col-right {
    width: 44%;
  }
  .info-block {
    margin-bottom: 8px;
  }
  .bullet-list {
    margin: 3px 0 0 0;
    padding-left: 14px;
    list-style-type: disc;
  }
  .bullet-list li {
    font-size: 10.5px;
    color: #374151;
    margin-bottom: 2.5px;
    line-height: 1.35;
  }
  .info-p {
    font-size: 10.5px;
    color: #374151;
    margin: 2px 0 0 0;
    line-height: 1.35;
  }

  /* Bank Details */
  .bank-section {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px 14px;
    margin-bottom: 9px;
  }
  .bank-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr 1fr;
    gap: 5px 16px;
    margin-top: 4px;
  }
  .bank-item {
    font-size: 10.5px;
  }
  .bank-item .b-lbl {
    color: #6b7280;
    font-size: 9.5px;
    margin-bottom: 1px;
  }
  .bank-item .b-val {
    color: #111827;
    font-weight: 600;
  }

  /* Notes */
  .notes-section {
    margin-bottom: 6px;
  }
  .notes-text {
    font-size: 9.5px;
    color: #4b5563;
    line-height: 1.42;
    margin: 2px 0 0 0;
  }

  /* Footer */
  .footer {
    border-top: 1px solid #e5e7eb;
    padding-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9.5px;
    color: #6b7280;
  }
</style>
</head>
<body>

<!-- Subtle Centered Watermark -->
<svg class="watermark" viewBox="0 0 700 700" xmlns="http://www.w3.org/2000/svg">
  <path fill="#01A92D" d="M283 505Q283 475 310 458L588 272Q625 250 662 272L942 458Q970 475 970 505V860Q970 922 905 922H487V822Q487 845 468 857L378 912Q350 928 318 912Q283 892 283 860Z" transform="translate(-275, -245)"/>
  <path fill="#fff" d="M487 922V600Q487 478 610 478L780 543Q837 565 837 625V922Z" transform="translate(-275, -245)"/>
  <path fill="#007A2A" d="M551 922V625Q551 548 625 550L735 592Q771 606 771 645V922Z" transform="translate(-275, -245)"/>
</svg>

<div class="page-container">
  <div class="top-content">
    <!-- Header -->
    <div class="header">
      <div class="logo-block">
        <svg class="brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3223 678">
          <g transform="translate(-277 -250)">
            <path fill="#01A92D" d="M283 505Q283 475 310 458L588 272Q625 250 662 272L942 458Q970 475 970 505V860Q970 922 905 922H487V822Q487 845 468 857L378 912Q350 928 318 912Q283 892 283 860Z"/>
            <path fill="#fff" d="M487 922V600Q487 478 610 478L780 543Q837 565 837 625V922Z"/>
            <path fill="#007A2A" d="M551 922V625Q551 548 625 550L735 592Q771 606 771 645V922Z"/>
          </g>
          <path fill="#111111" stroke="#111111" stroke-width="40" stroke-linejoin="round" transform="translate(826.2 562.7) scale(0.54537)" d="M216 0Q200 0 186.5 -9.5Q173 -19 168 -33L20 -477Q12 -508 20.5 -527.5Q29 -547 58 -547Q77 -547 89.5 -536.5Q102 -526 110 -501L236 -107H201L320 -509Q325 -526 337.0 -536.5Q349 -547 370 -547Q390 -547 402.5 -536.5Q415 -526 419 -509L516 -131H501L619 -501Q633 -547 671 -547Q699 -547 709.0 -527.5Q719 -508 708 -477L560 -33Q556 -19 543.0 -9.5Q530 0 513 0Q497 0 483.0 -9.5Q469 -19 465 -33L362 -414H372L264 -33Q260 -19 246.5 -9.5Q233 0 216 0Z M1111 4Q1030 4 968.0 -31.5Q906 -67 870.5 -129.5Q835 -192 835 -273Q835 -355 870.5 -417.5Q906 -480 968.0 -515.5Q1030 -551 1111 -551Q1191 -551 1253.0 -515.5Q1315 -480 1350.5 -417.5Q1386 -355 1386 -273Q1386 -192 1351.0 -129.5Q1316 -67 1254.0 -31.5Q1192 4 1111 4ZM1111 -86Q1163 -86 1203.0 -110.0Q1243 -134 1265.5 -176.0Q1288 -218 1288 -273Q1288 -328 1265.5 -370.5Q1243 -413 1203.0 -437.0Q1163 -461 1111 -461Q1059 -461 1019.0 -437.0Q979 -413 956.0 -370.5Q933 -328 933 -273Q933 -218 956.0 -176.0Q979 -134 1019.0 -110.0Q1059 -86 1111 -86Z M1831 4Q1753 4 1690.5 -32.5Q1628 -69 1591.5 -132.0Q1555 -195 1555 -274Q1555 -353 1588.5 -415.5Q1622 -478 1680.0 -514.5Q1738 -551 1811 -551Q1870 -551 1920.0 -526.5Q1970 -502 2004 -460V-730Q2004 -753 2018.5 -767.0Q2033 -781 2055 -781Q2078 -781 2092.0 -767.0Q2106 -753 2106 -730V-274Q2106 -195 2069.5 -132.0Q2033 -69 1971.0 -32.5Q1909 4 1831 4ZM1831 -86Q1882 -86 1922.0 -110.5Q1962 -135 1985.0 -178.0Q2008 -221 2008 -274Q2008 -328 1985.0 -370.0Q1962 -412 1922.0 -436.5Q1882 -461 1831 -461Q1781 -461 1740.5 -436.5Q1700 -412 1676.5 -370.0Q1653 -328 1653 -274Q1653 -221 1676.5 -178.0Q1700 -135 1740.5 -110.5Q1781 -86 1831 -86Z M2559 4Q2486 4 2428.0 -32.5Q2370 -69 2336.5 -131.5Q2303 -194 2303 -273Q2303 -352 2339.5 -415.0Q2376 -478 2438.5 -514.5Q2501 -551 2579 -551Q2657 -551 2719.0 -514.5Q2781 -478 2817.5 -415.0Q2854 -352 2854 -273H2815Q2815 -194 2781.5 -131.5Q2748 -69 2690.0 -32.5Q2632 4 2559 4ZM2579 -86Q2630 -86 2670.0 -110.5Q2710 -135 2733.0 -177.5Q2756 -220 2756 -273Q2756 -327 2733.0 -369.5Q2710 -412 2670.0 -436.5Q2630 -461 2579 -461Q2529 -461 2488.5 -436.5Q2448 -412 2424.5 -369.5Q2401 -327 2401 -273Q2401 -220 2424.5 -177.5Q2448 -135 2488.5 -110.5Q2529 -86 2579 -86ZM2803 1Q2781 1 2766.5 -13.5Q2752 -28 2752 -50V-203L2771 -309L2854 -273V-50Q2854 -28 2839.5 -13.5Q2825 1 2803 1Z M3513 1Q3491 1 3476.5 -13.5Q3462 -28 3462 -50V-296Q3462 -353 3441.0 -389.0Q3420 -425 3384.5 -442.5Q3349 -460 3303 -460Q3261 -460 3227.0 -443.0Q3193 -426 3173.0 -397.5Q3153 -369 3153 -332H3090Q3090 -395 3120.5 -444.5Q3151 -494 3204.0 -523.0Q3257 -552 3323 -552Q3392 -552 3446.5 -522.5Q3501 -493 3532.5 -436.0Q3564 -379 3564 -296V-50Q3564 -28 3549.5 -13.5Q3535 1 3513 1ZM3102 1Q3080 1 3065.5 -13.5Q3051 -28 3051 -50V-496Q3051 -519 3065.5 -533.0Q3080 -547 3102 -547Q3125 -547 3139.0 -533.0Q3153 -519 3153 -496V-50Q3153 -28 3139.0 -13.5Q3125 1 3102 1Z M4006 4Q3933 4 3875.0 -32.5Q3817 -69 3783.5 -131.5Q3750 -194 3750 -273Q3750 -352 3786.5 -415.0Q3823 -478 3885.5 -514.5Q3948 -551 4026 -551Q4104 -551 4166.0 -514.5Q4228 -478 4264.5 -415.0Q4301 -352 4301 -273H4262Q4262 -194 4228.5 -131.5Q4195 -69 4137.0 -32.5Q4079 4 4006 4ZM4026 -86Q4077 -86 4117.0 -110.5Q4157 -135 4180.0 -177.5Q4203 -220 4203 -273Q4203 -327 4180.0 -369.5Q4157 -412 4117.0 -436.5Q4077 -461 4026 -461Q3976 -461 3935.5 -436.5Q3895 -412 3871.5 -369.5Q3848 -327 3848 -273Q3848 -220 3871.5 -177.5Q3895 -135 3935.5 -110.5Q3976 -86 4026 -86ZM4250 1Q4228 1 4213.5 -13.5Q4199 -28 4199 -50V-203L4218 -309L4301 -273V-50Q4301 -28 4286.5 -13.5Q4272 1 4250 1Z"/>
        </svg>
        <div class="by-entity">by Antro-Pai Technologies Private Limited</div>
      </div>

      <div class="invoice-meta-block">
        <div class="invoice-title">Invoice</div>
        <table class="meta-table">
          <tr>
            <td class="label">Invoice No.</td>
            <td class="val">WOD-INV-2026-111</td>
          </tr>
          <tr>
            <td class="label">Invoice Date</td>
            <td class="val">30 Sep 2026</td>
          </tr>
          <tr>
            <td class="label">Due Date</td>
            <td class="val">7 Oct 2026</td>
          </tr>
          <tr>
            <td class="label">Offer Valid Until</td>
            <td class="val">7 Oct 2026</td>
          </tr>
          <tr>
            <td class="label">Currency</td>
            <td class="val">AED</td>
          </tr>
          <tr>
            <td class="label">Reference</td>
            <td class="val">Palm Living, Wodana</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Divider -->
    <div class="divider"></div>

    <!-- Parties Grid -->
    <div class="parties-grid">
      <div class="party-col">
        <div class="section-label">FROM</div>
        <div class="party-name">Antro-Pai Technologies Private Limited</div>
        <div class="party-address">
          201, Ram Krishna Nivas Towers, Sanjeeva Reddy Nagar<br>
          Hyderabad, Telangana 500038, India<br>
          support@wodana.ai | www.wodana.ai
        </div>
      </div>

      <div class="party-col">
        <div class="section-label">BILL TO</div>
        <div class="party-name">PLM Interiors Trading L.L.C.</div>
        <div class="party-sub">Palm Living Interiors</div>
        <div class="party-address">
          Level 1, Centro Al Andalus, Jumeirah Golf Estates<br>
          Dubai, United Arab Emirates
        </div>
      </div>
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-desc">DESCRIPTION</th>
          <th class="col-qty">QTY</th>
          <th class="col-unit">UNIT PRICE</th>
          <th class="col-amount">AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="col-num">1</td>
          <td class="col-desc">
            <div class="item-title">Wodana annual user subscription</div>
            <div class="item-desc">Minimum pack of 20 named users, 12-month access</div>
          </td>
          <td class="col-qty">20</td>
          <td class="col-unit">AED 550.88</td>
          <td class="col-amount">AED 11,017.50</td>
        </tr>
        <tr>
          <td class="col-num">2</td>
          <td class="col-desc">
            <div class="item-title">Wodana platform onboarding (one-time)</div>
            <div class="item-desc">Workspace setup, workflow configuration and 2 weeks of onboarding sessions</div>
          </td>
          <td class="col-qty">1</td>
          <td class="col-unit">AED 1,836.25</td>
          <td class="col-amount">AED 1,836.25</td>
        </tr>
      </tbody>
    </table>

    <!-- Totals & Payment Status -->
    <div class="summary-container">
      <table class="summary-table">
        <tr>
          <td class="s-label">Subtotal</td>
          <td class="s-val">AED 12,853.75</td>
        </tr>
        <tr>
          <td class="s-label">Tax</td>
          <td class="s-val">As applicable</td>
        </tr>
        <tr class="total-contract-row">
          <td class="s-label">Total Contract Value</td>
          <td class="s-val">AED 12,853.75</td>
        </tr>
        <tr class="advance-due-row">
          <td class="s-label">Current Invoice (50% Advance Due)</td>
          <td class="s-val">AED 5,508.75</td>
        </tr>
        <tr class="balance-row">
          <td class="s-label">Balance before go-live</td>
          <td class="s-val">AED 7,345.00</td>
        </tr>
      </table>
    </div>

    <!-- Divider -->
    <div class="divider" style="margin: 6px 0 11px 0;"></div>

    <!-- Details Grid -->
    <div class="info-grid">
      <div class="info-col-left">
        <div class="info-block">
          <div class="section-label">PAYMENT SCHEDULE</div>
          <ul class="bullet-list">
            <li><strong>50% advance (due now):</strong> AED 5,508.75 (USD 1,500)</li>
            <li><strong>Balance before go-live:</strong> AED 7,345.00 (USD 2,000)</li>
          </ul>
        </div>
        <div class="info-block" style="margin-bottom: 0;">
          <div class="section-label">RENEWAL</div>
          <p class="info-p">
            The subscription renews every year. The minimum pack is <strong>20 users</strong> (AED 11,017.50 / USD 3,000).
          </p>
        </div>
      </div>

      <div class="info-col-right">
        <div class="info-block">
          <div class="section-label">INCLUDED IN THIS PACKAGE</div>
          <ul class="bullet-list">
            <li>Cloud hosting</li>
            <li>AI credits</li>
            <li>Workspace setup & 2 weeks onboarding sessions</li>
          </ul>
        </div>
        <div class="info-block" style="margin-bottom: 0;">
          <div class="section-label">ADDITIONAL USERS</div>
          <p class="info-p">
            From the 21st user onwards, each additional user is charged at <strong>AED 477.43</strong> (USD 130) per year.
          </p>
        </div>
      </div>
    </div>

    <!-- Bank Details -->
    <div class="bank-section">
      <div class="section-label" style="margin-bottom: 3px;">PAYMENT METHOD: BANK TRANSFER</div>
      <div class="bank-grid">
        <div class="bank-item">
          <div class="b-lbl">Account name</div>
          <div class="b-val">Antro-Pai Technologies Private Limited</div>
        </div>
        <div class="bank-item">
          <div class="b-lbl">Account number</div>
          <div class="b-val">778405000148</div>
        </div>
        <div class="bank-item">
          <div class="b-lbl">Bank</div>
          <div class="b-val">ICICI Bank</div>
        </div>
        <div class="bank-item">
          <div class="b-lbl">Account type</div>
          <div class="b-val">Current account</div>
        </div>
        <div class="bank-item">
          <div class="b-lbl">IFSC</div>
          <div class="b-val">ICIC0007784</div>
        </div>
        <div class="bank-item">
          <div class="b-lbl">SWIFT code</div>
          <div class="b-val">ICICINBBXXX</div>
        </div>
        <div class="bank-item" style="grid-column: span 3; padding-top: 2px;">
          <span class="b-lbl">Payment reference: </span>
          <span class="b-val" style="color: #065f46;">WOD-INV-2026-111</span>
        </div>
      </div>
    </div>

    <!-- Notes -->
    <div class="notes-section">
      <div class="section-label" style="margin-bottom: 2px;">NOTES</div>
      <p class="notes-text">
        This invoice covers the 50% advance for the annual subscription for 20 named Wodana users (12 months), plus one-time platform onboarding, workspace setup, workflow configuration and 2 weeks of onboarding sessions. Cloud hosting and AI credits are included. Total contract value is AED 12,853.75, with AED 5,508.75 payable on this current invoice and the remaining balance of AED 7,345.00 due before go-live. Custom development and third-party integrations are excluded unless agreed separately in writing.
      </p>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>Antro-Pai Technologies Private Limited | Hyderabad, Telangana, India</div>
    <div>www.wodana.ai | support@wodana.ai</div>
  </div>
</div>

</body>
</html>
"""

with open('/tmp/invoice.html', 'w') as f:
    f.write(HTML_CONTENT)

print("Updated HTML written to /tmp/invoice.html")
