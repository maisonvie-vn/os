import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const {
      agencyName,
      type,
      groupName,
      eventDate,
      pax,
      customNote,
      includeFrench,
      templateVi,
      templateEn,
      templateFr,
    } = await request.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      const systemPrompt = `You are a professional assistant writing emails for Maison Vie, a luxury neoclassical villa restaurant. You will generate a bilingual (Vietnamese + English) or trilingual (Vietnamese + English + French) email draft based on the template and details provided. Make the tone warm, elegant, and professional. Blend the custom note naturally into the email body. Return ONLY a JSON object with:
{
  "subject": "Email Subject in VI & EN (and FR if selected)",
  "body_vi": "The complete body in Vietnamese",
  "body_en": "The complete body in English",
  "body_fr": "The complete body in French (only if requested, otherwise null)"
}`;
      const userPrompt = `
Template VI: ${templateVi}
Template EN: ${templateEn}
Template FR: ${templateFr}

Inputs:
- Agency Name: ${agencyName}
- Group Name: ${groupName}
- Event Date: ${eventDate}
- Pax Count: ${pax}
- Custom Note: ${customNote || "None"}
- Include French: ${includeFrench ? "Yes" : "No"}
`;
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (response.ok) {
        const resData = await response.json();
        const text = resData.content[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return NextResponse.json(parsed);
        }
      }
    }

    // Fallback: Programmatic template substitution
    const replaceVars = (tmpl: string) => {
      return tmpl
        .replace(/{agency_name}/g, agencyName || "Quý Agency")
        .replace(/{group_name}/g, groupName || "Đoàn khách")
        .replace(/{event_date}/g, eventDate || "Ngày sự kiện")
        .replace(/{pax}/g, String(pax || "0"))
        .replace(/{custom_note}/g, customNote ? `${customNote}` : "");
    };

    let subject = "Thư liên hệ - Maison Vie Restaurant";
    if (type === "CONFIRMATION") subject = `Xác nhận lịch đặt đoàn ${groupName || ""} - Maison Vie`;
    if (type === "THANK_YOU") subject = `Thư cảm ơn đoàn ${groupName || ""} - Maison Vie`;
    if (type === "APOLOGY") subject = `Thư cáo lỗi & Khắc phục sự cố đoàn ${groupName || ""} - Maison Vie`;
    if (type === "HOLIDAY") subject = `Chúc mừng dịp lễ tết - Maison Vie`;

    return NextResponse.json({
      subject,
      body_vi: replaceVars(templateVi),
      body_en: replaceVars(templateEn),
      body_fr: includeFrench ? replaceVars(templateFr) : null,
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
