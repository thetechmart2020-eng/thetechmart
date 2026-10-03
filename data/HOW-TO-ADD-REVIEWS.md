# Adding reviews

The slideshow comes from the Elfsight widget (id in "elfsightId"). It pulls Facebook reviews itself. The manual list below is optional, for things the widget cannot show, such as WhatsApp screenshots.

Edit data/reviews.json. The Reviews section appears on the homepage once the list has at least one entry, and stays hidden while it is empty.

Top of the file:
  "facebookUrl": "https://www.facebook.com/your-page"   (shows a button and a footer link)
  "googleUrl": "https://g.page/r/your-review-link"      (add once verified)

Each review (copy the wording exactly as the customer wrote it):

  { "source": "facebook", "name": "Sipho M.", "date": "2026-09-12", "text": "Exact words here", "url": "https://facebook.com/.../posts/123", "rating": 5 }

  { "source": "whatsapp", "name": "Lerato K.", "date": "2026-09-20", "image": "/img/reviews/lerato-chat.jpg", "alt": "WhatsApp chat: customer confirms phone arrived as described" }

  { "source": "google", "name": "Thabo N.", "date": "2026-10-30", "text": "Exact words here", "rating": 5, "url": "https://..." }

source must be facebook, whatsapp or google. url, rating and date are optional. url must start with https://.
WhatsApp screenshots: save in public/img/reviews/, use only letters, numbers, dot, dash. Blur phone numbers and any address or other private details before saving. Get the customer's OK first.
Separate entries with commas. Check the file at jsonlint.com before uploading.
