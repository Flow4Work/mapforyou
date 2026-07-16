"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type Language = "ja" | "en";
type BookingCategory = "restaurant" | "hair" | "nail" | "beauty";

type FormState = {
  category: BookingCategory;
  placeName: string;
  placeUrl: string;
  preferredDate: string;
  preferredTime: string;
  alternativeDate: string;
  alternativeTime: string;
  partySize: string;
  requestDetails: string;
  customerName: string;
  customerEmail: string;
  customerCountry: string;
  consent: boolean;
  website: string;
};

const INITIAL_FORM: FormState = {
  category: "restaurant",
  placeName: "",
  placeUrl: "",
  preferredDate: "",
  preferredTime: "19:00",
  alternativeDate: "",
  alternativeTime: "19:00",
  partySize: "2",
  requestDetails: "",
  customerName: "",
  customerEmail: "",
  customerCountry: "JP",
  consent: false,
  website: "",
};

const COPY = {
  ja: {
    navExplore: "お店を探す",
    navRequest: "予約を依頼",
    eyebrow: "韓国予約コンシェルジュ",
    title: "韓国のお店、\n代わりに予約します。",
    description: "韓国の電話番号や韓国語がなくても大丈夫。レストランや美容室へ確認し、予約可能な場合だけお支払いをご案内します。",
    primaryCta: "予約を依頼する",
    secondaryCta: "対応店舗を探す",
    trustOne: "韓国の電話番号不要",
    trustTwo: "日本語で依頼",
    trustThree: "PayPal・カード対応",
    sampleLabel: "予約状況",
    sampleTitle: "ソンス食堂 · 2名",
    sampleStatus: "店舗へ確認中",
    sampleTimelineOne: "依頼受付",
    sampleTimelineTwo: "空席を確認",
    sampleTimelineThree: "決済後に確定",
    howLabel: "利用方法",
    howTitle: "面倒な予約だけ、私たちが代行します",
    steps: [
      ["01", "希望を送る", "お店、日時、人数、希望内容を日本語で入力します。"],
      ["02", "店舗へ確認", "韓国語で電話または店舗の公式連絡先へ確認します。"],
      ["03", "支払い後に確定", "予約可能な場合だけ、手数料と店舗予約金の決済リンクを送ります。"],
    ],
    priceLabel: "料金とキャンセル",
    priceTitle: "先に払う必要はありません",
    priceDescription: "空席を確認できなかった場合、請求はありません。予約可能と確認できた後に、内容を確認してから支払います。",
    feeTitle: "予約代行手数料",
    feeValue: "目安 ¥700〜",
    feeNote: "予約確定後は返金不可",
    depositTitle: "店舗の予約金",
    depositValue: "店舗の実費",
    depositNote: "店舗のキャンセル規定を適用",
    paymentTitle: "支払い方法",
    paymentValue: "PayPal・対応カード",
    paymentNote: "メールで安全な決済リンクを案内",
    noShowTitle: "来店しなかった場合",
    noShowText: "予約代行手数料は返金されません。店舗予約金は店舗のノーショー規定に従い、一部または全額が失われる場合があります。",
    formLabel: "予約リクエスト",
    formTitle: "行きたいお店を教えてください",
    formDescription: "店舗の予約可否を先に確認します。通常は24時間以上先の予約を依頼してください。",
    category: "予約の種類",
    categories: {
      restaurant: "レストラン",
      hair: "ヘアサロン",
      nail: "ネイル",
      beauty: "その他ビューティー",
    },
    placeName: "店舗名",
    placeNamePlaceholder: "例：ソンス○○食堂",
    placeUrl: "店舗URL・Instagram",
    placeUrlPlaceholder: "Google Maps、Naver、Instagramなど",
    preferred: "第一希望",
    alternative: "第二希望（任意）",
    partySize: "人数",
    details: "希望内容・注意事項",
    detailsPlaceholder: "アレルギー、希望メニュー、ヘアスタイル、予算など",
    name: "予約者名",
    namePlaceholder: "パスポートと同じ英字名を推奨",
    email: "メールアドレス",
    country: "居住国",
    consent: "予約条件、キャンセル・ノーショー規定、個人情報の利用に同意します。",
    submit: "無料で空席確認を依頼",
    submitting: "送信中…",
    successTitle: "予約リクエストを受け付けました",
    successDescription: "店舗へ確認後、このメールアドレスに結果と決済案内を送ります。まだ予約は確定していません。",
    requestCode: "受付番号",
    another: "別の予約を依頼",
    error: "送信できませんでした。入力内容を確認して、もう一度お試しください。",
    footer: "MapForYou · Seoul booking concierge",
    footerNotice: "予約の成立や店舗のサービス品質を保証するものではありません。医療予約には対応していません。",
  },
  en: {
    navExplore: "Explore places",
    navRequest: "Request booking",
    eyebrow: "Korea booking concierge",
    title: "We book Korean places\nfor you.",
    description: "No Korean phone number or Korean language needed. We contact restaurants and beauty salons, and only ask you to pay after availability is confirmed.",
    primaryCta: "Request a booking",
    secondaryCta: "Explore places",
    trustOne: "No Korean phone number",
    trustTwo: "Request in English",
    trustThree: "PayPal and cards",
    sampleLabel: "Booking status",
    sampleTitle: "Seongsu restaurant · 2 guests",
    sampleStatus: "Checking with the venue",
    sampleTimelineOne: "Request received",
    sampleTimelineTwo: "Availability check",
    sampleTimelineThree: "Confirmed after payment",
    howLabel: "How it works",
    howTitle: "We handle the bookings that are difficult to make yourself",
    steps: [
      ["01", "Send your request", "Tell us the place, dates, group size, and any special request."],
      ["02", "We contact the venue", "We call or use the venue's official contact channel in Korean."],
      ["03", "Pay and confirm", "Only after availability is confirmed, we send the service fee and venue deposit payment link."],
    ],
    priceLabel: "Price and cancellation",
    priceTitle: "No upfront payment",
    priceDescription: "If the venue is unavailable, you pay nothing. After we confirm availability, you review the details before paying.",
    feeTitle: "Booking service fee",
    feeValue: "From about ¥700",
    feeNote: "Non-refundable after confirmation",
    depositTitle: "Venue deposit",
    depositValue: "Actual venue amount",
    depositNote: "Venue cancellation rules apply",
    paymentTitle: "Payment",
    paymentValue: "PayPal or supported cards",
    paymentNote: "Secure payment link sent by email",
    noShowTitle: "If you do not show up",
    noShowText: "The booking service fee is not refundable. The venue deposit may be partially or fully forfeited under the venue's no-show policy.",
    formLabel: "Booking request",
    formTitle: "Tell us where you want to go",
    formDescription: "We check availability first. Please request bookings at least 24 hours in advance whenever possible.",
    category: "Booking type",
    categories: {
      restaurant: "Restaurant",
      hair: "Hair salon",
      nail: "Nail salon",
      beauty: "Other beauty",
    },
    placeName: "Place name",
    placeNamePlaceholder: "Example: Seongsu restaurant name",
    placeUrl: "Place URL or Instagram",
    placeUrlPlaceholder: "Google Maps, Naver, Instagram, etc.",
    preferred: "First choice",
    alternative: "Second choice (optional)",
    partySize: "Guests",
    details: "Requests and notes",
    detailsPlaceholder: "Allergies, menu, hairstyle, budget, and other details",
    name: "Booking name",
    namePlaceholder: "Use the same English name as your passport",
    email: "Email",
    country: "Country of residence",
    consent: "I agree to the booking, cancellation, no-show, and privacy terms.",
    submit: "Request a free availability check",
    submitting: "Sending…",
    successTitle: "Your request has been received",
    successDescription: "We will email the result and payment instructions after checking with the venue. Your booking is not confirmed yet.",
    requestCode: "Request code",
    another: "Request another booking",
    error: "We could not send your request. Check the form and try again.",
    footer: "MapForYou · Seoul booking concierge",
    footerNotice: "We do not guarantee availability or venue service quality. Medical bookings are not supported.",
  },
} as const;

export default function BookingConciergeHome() {
  const [language, setLanguage] = useState<Language>("ja");
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [requestCode, setRequestCode] = useState("");
  const copy = COPY[language];

  const minimumDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.consent) return;

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/booking-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, language }),
      });
      const data = (await response.json()) as { requestCode?: string; error?: string };
      if (!response.ok || !data.requestCode) throw new Error(data.error || copy.error);
      setRequestCode(data.requestCode);
      setForm(INITIAL_FORM);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.error);
    } finally {
      setSubmitting(false);
    }
  }

  function scrollToForm() {
    document.getElementById("booking-request")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="booking-page">
      <header className="booking-header">
        <Link className="booking-logo" href="/" aria-label="MapForYou home">
          <span>M</span>
          <strong>MapForYou</strong>
        </Link>
        <nav className="booking-nav">
          <Link href="/explore">{copy.navExplore}</Link>
          <button type="button" onClick={scrollToForm}>{copy.navRequest}</button>
          <div className="booking-language" aria-label="Language selector">
            <button className={language === "ja" ? "active" : ""} type="button" onClick={() => setLanguage("ja")}>日本語</button>
            <button className={language === "en" ? "active" : ""} type="button" onClick={() => setLanguage("en")}>EN</button>
          </div>
        </nav>
      </header>

      <section className="booking-hero">
        <div className="booking-hero-copy">
          <p className="booking-kicker">{copy.eyebrow}</p>
          <h1>{copy.title.split("\n").map((line) => <span key={line}>{line}</span>)}</h1>
          <p className="booking-hero-description">{copy.description}</p>
          <div className="booking-hero-actions">
            <button className="booking-primary" type="button" onClick={scrollToForm}>{copy.primaryCta}</button>
            <Link className="booking-secondary" href="/explore">{copy.secondaryCta}</Link>
          </div>
          <div className="booking-trust-row">
            <span>✓ {copy.trustOne}</span>
            <span>✓ {copy.trustTwo}</span>
            <span>✓ {copy.trustThree}</span>
          </div>
        </div>

        <div className="booking-status-preview" aria-hidden="true">
          <div className="booking-preview-top">
            <span>{copy.sampleLabel}</span>
            <i />
          </div>
          <h2>{copy.sampleTitle}</h2>
          <div className="booking-preview-status">
            <span className="booking-spinner" />
            <strong>{copy.sampleStatus}</strong>
          </div>
          <ol>
            <li className="done"><span>1</span><p>{copy.sampleTimelineOne}</p></li>
            <li className="active"><span>2</span><p>{copy.sampleTimelineTwo}</p></li>
            <li><span>3</span><p>{copy.sampleTimelineThree}</p></li>
          </ol>
        </div>
      </section>

      <section className="booking-section booking-how">
        <div className="booking-section-heading">
          <p>{copy.howLabel}</p>
          <h2>{copy.howTitle}</h2>
        </div>
        <div className="booking-step-grid">
          {copy.steps.map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="booking-section booking-pricing">
        <div className="booking-pricing-copy">
          <p className="booking-section-label">{copy.priceLabel}</p>
          <h2>{copy.priceTitle}</h2>
          <p>{copy.priceDescription}</p>
          <div className="booking-noshow-box">
            <strong>{copy.noShowTitle}</strong>
            <span>{copy.noShowText}</span>
          </div>
        </div>
        <div className="booking-price-card">
          <div>
            <span>{copy.feeTitle}</span>
            <strong>{copy.feeValue}</strong>
            <small>{copy.feeNote}</small>
          </div>
          <div>
            <span>{copy.depositTitle}</span>
            <strong>{copy.depositValue}</strong>
            <small>{copy.depositNote}</small>
          </div>
          <div>
            <span>{copy.paymentTitle}</span>
            <strong>{copy.paymentValue}</strong>
            <small>{copy.paymentNote}</small>
          </div>
        </div>
      </section>

      <section id="booking-request" className="booking-form-section">
        <div className="booking-form-intro">
          <p>{copy.formLabel}</p>
          <h2>{copy.formTitle}</h2>
          <span>{copy.formDescription}</span>
        </div>

        <div className="booking-form-card">
          {requestCode ? (
            <div className="booking-success">
              <span>✓</span>
              <h3>{copy.successTitle}</h3>
              <p>{copy.successDescription}</p>
              <div><small>{copy.requestCode}</small><strong>{requestCode}</strong></div>
              <button type="button" onClick={() => setRequestCode("")}>{copy.another}</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <label className="booking-field booking-field-wide">
                <span>{copy.category}</span>
                <div className="booking-category-grid">
                  {(Object.keys(copy.categories) as BookingCategory[]).map((item) => (
                    <button
                      className={form.category === item ? "active" : ""}
                      type="button"
                      key={item}
                      onClick={() => update("category", item)}
                    >
                      {copy.categories[item]}
                    </button>
                  ))}
                </div>
              </label>

              <label className="booking-field">
                <span>{copy.placeName}</span>
                <input required value={form.placeName} onChange={(event) => update("placeName", event.target.value)} placeholder={copy.placeNamePlaceholder} maxLength={120} />
              </label>

              <label className="booking-field">
                <span>{copy.placeUrl}</span>
                <input type="url" value={form.placeUrl} onChange={(event) => update("placeUrl", event.target.value)} placeholder={copy.placeUrlPlaceholder} maxLength={500} />
              </label>

              <fieldset className="booking-fieldset">
                <legend>{copy.preferred}</legend>
                <input aria-label={`${copy.preferred} date`} required type="date" min={minimumDate} value={form.preferredDate} onChange={(event) => update("preferredDate", event.target.value)} />
                <input aria-label={`${copy.preferred} time`} required type="time" value={form.preferredTime} onChange={(event) => update("preferredTime", event.target.value)} />
              </fieldset>

              <fieldset className="booking-fieldset">
                <legend>{copy.alternative}</legend>
                <input aria-label={`${copy.alternative} date`} type="date" min={minimumDate} value={form.alternativeDate} onChange={(event) => update("alternativeDate", event.target.value)} />
                <input aria-label={`${copy.alternative} time`} type="time" value={form.alternativeTime} onChange={(event) => update("alternativeTime", event.target.value)} />
              </fieldset>

              <label className="booking-field">
                <span>{copy.partySize}</span>
                <input required type="number" min="1" max="20" value={form.partySize} onChange={(event) => update("partySize", event.target.value)} />
              </label>

              <label className="booking-field booking-field-wide">
                <span>{copy.details}</span>
                <textarea value={form.requestDetails} onChange={(event) => update("requestDetails", event.target.value)} placeholder={copy.detailsPlaceholder} maxLength={1500} />
              </label>

              <label className="booking-field">
                <span>{copy.name}</span>
                <input required value={form.customerName} onChange={(event) => update("customerName", event.target.value)} placeholder={copy.namePlaceholder} maxLength={100} />
              </label>

              <label className="booking-field">
                <span>{copy.email}</span>
                <input required type="email" value={form.customerEmail} onChange={(event) => update("customerEmail", event.target.value)} placeholder="name@example.com" maxLength={180} />
              </label>

              <label className="booking-field">
                <span>{copy.country}</span>
                <select value={form.customerCountry} onChange={(event) => update("customerCountry", event.target.value)}>
                  <option value="JP">日本 / Japan</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="CA">Canada</option>
                  <option value="SG">Singapore</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>

              <label className="booking-honeypot" aria-hidden="true">
                Website
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update("website", event.target.value)} />
              </label>

              <label className="booking-consent booking-field-wide">
                <input required type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} />
                <span>{copy.consent}</span>
              </label>

              {error && <p className="booking-error" role="alert">{error}</p>}
              <button className="booking-submit booking-field-wide" disabled={submitting || !form.consent} type="submit">
                {submitting ? copy.submitting : copy.submit}
              </button>
            </form>
          )}
        </div>
      </section>

      <footer className="booking-footer">
        <strong>{copy.footer}</strong>
        <p>{copy.footerNotice}</p>
      </footer>
    </main>
  );
}
