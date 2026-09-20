// Profile card extras: country / languages lists + picture zoom-focus.
// Country stored as the plain English name; languages as up to two names.

export const COUNTRIES: string[] = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia",
  "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados",
  "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina",
  "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia",
  "Cameroon", "Canada", "Cape Verde", "Central African Republic", "Chad", "Chile", "China",
  "Colombia", "Comoros", "Congo", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czechia",
  "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
  "Fiji", "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana",
  "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana", "Haiti",
  "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati",
  "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos", "Latvia",
  "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands",
  "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal",
  "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia",
  "Norway", "Oman", "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea",
  "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania",
  "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia",
  "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe",
  "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore",
  "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan",
  "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
  "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga",
  "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda",
  "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
  "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela", "Vietnam", "Yemen", "Zambia",
  "Zimbabwe",
];

export const LANGUAGES: string[] = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch",
  "Russian", "Polish", "Ukrainian", "Romanian", "Greek", "Turkish", "Arabic",
  "Hebrew", "Hindi", "Bengali", "Urdu", "Chinese", "Cantonese", "Japanese",
  "Korean", "Vietnamese", "Thai", "Indonesian", "Malay", "Tagalog", "Swedish",
  "Norwegian", "Danish", "Finnish", "Czech", "Slovak", "Hungarian", "Serbian",
  "Croatian", "Bulgarian", "Persian", "Swahili", "Zulu", "Afrikaans", "Icelandic",
  "Catalan", "Basque", "Galician", "Welsh", "Irish", "Latin", "Esperanto",
];

// Picture zoom-focus: which part of the uploaded photo shows in the round
// crop. x/y are object-position percents, zoom is a scale factor.
export type Crop = { zoom: number; x: number; y: number };

export const DEFAULT_CROP: Crop = { zoom: 1, x: 50, y: 50 };

export function sanitizeCrop(v: unknown): Crop {
  const c = (v || {}) as Partial<Crop>;
  const num = (n: unknown, fb: number) => (typeof n === "number" && Number.isFinite(n) ? n : fb);
  return {
    zoom: Math.min(3, Math.max(1, num(c.zoom, 1))),
    x: Math.min(100, Math.max(0, num(c.x, 50))),
    y: Math.min(100, Math.max(0, num(c.y, 50))),
  };
}

/** img style rendering a Crop inside an overflow-hidden round wrapper. */
export function cropImgStyle(crop: Crop | null | undefined): React.CSSProperties {
  const c = sanitizeCrop(crop);
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${c.x}% ${c.y}%`,
    transform: `scale(${c.zoom})`,
  };
}

/** Cozy muted card-background presets ('' = default cream). */
export const CARD_COLORS: string[] = [
  "#e3c98f", "#dfb3a4", "#bccba4", "#a9c6c1", "#a9bedd", "#c3b2d6", "#b5d3b5", "#d6a8a8",
];

/** Card text presets ('' = default ink). */
export const TEXT_COLORS: string[] = [
  "#4a3728", "#6b543f", "#faf3df", "#ffffff", "#2b1f16",
];
