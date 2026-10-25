import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bs4 import BeautifulSoup

from purchasing import crawler, history, insights, links, pipeline, questions, scoring, settings_store


def supplier(name, price, mah=None, months=None, vat=None, relevance=1.0):
    return {"name": name, "price": price, "mah": mah, "warranty_months": months, "vat": vat,
            "vat_included": False, "relevance": relevance, "url": "https://" + name, "title": name,
            "description": "", "date": None, "volt": None, "contacts": {}}


class ScoringTests(unittest.TestCase):
    def test_no_vat_supplier_is_excluded(self):
        result = scoring.score_suppliers([supplier("a.vn", 100000, 20000, 12, False), supplier("b.vn", 200000, 20000, 6, True)])
        excluded = next(r for r in result if r["name"] == "a.vn")
        self.assertFalse(excluded["eligible"])
        self.assertTrue(next(r for r in result if r["name"] == "b.vn")["recommended"])

    def test_cheaper_per_mah_wins_when_other_fields_equal(self):
        result = scoring.score_suppliers([supplier("a.vn", 400000, 20000, 12, True), supplier("b.vn", 400000, 40000, 12, True)])
        self.assertEqual(result[0]["name"], "b.vn")


class QuestionTests(unittest.TestCase):
    def test_cards_detect_spec_and_ocr(self):
        cards = questions.build_cards({"query": "quạt 20000mAh 18V", "quantity": 5, "purpose": "", "product_code": ""}, None, "GIFV F20")
        by_id = {c["id"]: c for c in cards}
        self.assertEqual(by_id["mah"]["default"], "20000")
        self.assertEqual(by_id["volt"]["default"], "18")
        self.assertEqual(by_id["quantity"]["default"], "5")
        self.assertIn("ocr", by_id)


class ContactTests(unittest.TestCase):
    def test_extracts_phone_zalo_email(self):
        html = '<a href="tel:0986670832">x</a><a href="https://zalo.me/0986670832">z</a><a href="mailto:a@b.vn">m</a>'
        soup = BeautifulSoup(html, "html.parser")
        c = crawler.extract_contacts(soup, "https://shop.vn/p", "Hotline 0912 345 678")
        self.assertIn("0986670832", c["phones"])
        self.assertIn("0912345678", c["phones"])
        self.assertEqual(c["emails"], ["a@b.vn"])
        self.assertFalse(c["zalo_guess"])

    def test_zalo_guessed_from_phone(self):
        c = crawler.extract_contacts(BeautifulSoup("", "html.parser"), "https://shop.vn", "Gọi 0912345678")
        self.assertTrue(c["zalo_guess"])


class LinkTests(unittest.TestCase):
    def test_csv_import(self):
        urls = links.parse_link_file("x.csv", "NCC,Link\na,https://a.vn\nb,https://b.vn\n".encode())
        self.assertEqual(urls, ["https://a.vn", "https://b.vn"])


class SettingsTests(unittest.TestCase):
    def test_update_mask_and_clear(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings_store.SETTINGS_FILE = Path(tmp) / "settings.json"
            settings_store.update({"BRAVE_API_KEY": "abcdefghijkl"})
            view = settings_store.public_view()["BRAVE_API_KEY"]
            self.assertTrue(view["configured"])
            self.assertNotIn("abcdefghijkl", view["display"])
            settings_store.update({"BRAVE_API_KEY": None})
            self.assertTrue(settings_store.public_view()["BRAVE_API_KEY"]["configured"])
            settings_store.update({"BRAVE_API_KEY": ""})
            self.assertFalse(settings_store.public_view()["BRAVE_API_KEY"]["configured"])
            with self.assertRaises(ValueError):
                settings_store.update({"NOPE": "x"})


class InsightTests(unittest.TestCase):
    def test_price_ratio(self):
        rows = insights.price_comparison([{"name": "a", "price": 100}, {"name": "b", "price": 250}])
        self.assertEqual(rows[1]["ratio"], 250.0)


class RescoreTests(unittest.TestCase):
    def test_rescoring_clears_old_recommendation(self):
        first = scoring.score_suppliers([supplier("a.vn", 100000, 20000, 12, True), supplier("b.vn", 300000, 20000, 12, True)])
        self.assertTrue(first[0]["recommended"])
        for row in first:
            if row["name"] == "b.vn":
                row["price"] = 10000
        again = scoring.score_suppliers(first)
        self.assertEqual([r["name"] for r in again if r["recommended"]], ["b.vn"])


class EditParsingTests(unittest.TestCase):
    def test_parse_fields(self):
        self.assertEqual(pipeline._parse_field("price", "1.190.000"), 1190000)
        self.assertIsNone(pipeline._parse_field("price", ""))
        self.assertEqual(pipeline._parse_field("date", "01/07/2024"), "2024-07-01")
        self.assertIs(pipeline._parse_field("vat", "Có"), True)
        self.assertIsNone(pipeline._parse_field("vat", "Chưa rõ"))
        with self.assertRaises(ValueError):
            pipeline._parse_field("price", "abc")
        with self.assertRaises(ValueError):
            pipeline._parse_field("warranty_months", "9999")


class HistoryTests(unittest.TestCase):
    def test_groups_by_product_name_ignoring_accents_and_case(self):
        def job(i, query, price):
            s = supplier("a.vn", price)
            return {"id": str(i), "status": "done", "query": query, "keywords": query, "created": f"2026-01-0{i}T10:00:00",
                    "engines": ["bing"], "suppliers": [s], "sites_searched": ["https://a.vn/x", "https://b.vn/y"], "research": {},
                    "quantity": 10, "edits": []}
        groups = history.group_history([job(1, "Áo điều hòa", 100), job(2, "ao dieu hoa", 300), job(3, "Quạt", 50)])
        self.assertEqual(len(groups), 2)
        shirt = next(g for g in groups if g["searches"] == 2)
        self.assertEqual(shirt["avg_price"], 200)
        self.assertEqual({s["domain"] for s in shirt["sites"]}, {"a.vn", "b.vn"})
        self.assertEqual(shirt["price_change_pct"], 200.0)


class PersuasionTests(unittest.TestCase):
    def test_sections_follow_purchasing_process(self):
        sup = scoring.score_suppliers([supplier("a.vn", 100000, 20000, 12, True), supplier("b.vn", 300000, 20000, 6, True)])
        result = insights.build_insights(sup, 10, {"product": "quạt", "spec": "20.000 mAh", "purpose": "ngoài trời", "research": {}})
        headings = [s["heading"] for s in result["persuasion"]["sections"]]
        self.assertTrue(headings[0].startswith("1. Nhu cầu"))
        self.assertIn("4. Rủi ro và cách kiểm soát", headings)
        self.assertIn("a.vn", insights.persuasion_text(result["persuasion"]))
        self.assertTrue(result["negotiation"][0]["steps"])


if __name__ == "__main__":
    unittest.main()
