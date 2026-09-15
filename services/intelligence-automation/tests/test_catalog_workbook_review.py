from wodana_intelligence.catalog_workbook_review import (
    Cell,
    ImagePlacement,
    SheetData,
    review_sheets,
)


def test_review_groups_repeated_products_as_variants_without_importing_prices() -> None:
    sheet = SheetData(
        name="Cabinet",
        rows={
            3: {
                "A": Cell("REMARKS"),
                "B": Cell("ITEM"),
                "C": Cell("DESCRIPTION"),
                "D": Cell("IMAGE"),
                "E": Cell("LENGTH (CM)"),
                "F": Cell("PRICE (AED)"),
            },
            4: {
                "A": Cell("Need to be added to the brochure."),
                "B": Cell("CABINET"),
                "C": Cell("Anya Media Cabinet"),
                "E": Cell("160 cm"),
                "F": Cell("ENQUIRE NOW"),
            },
            5: {
                "B": Cell("CABINET"),
                "C": Cell("Anya Media Cabinet"),
                "E": Cell("180 cm"),
                "F": Cell("19,800"),
                "J": Cell("123", "100+23"),
            },
        },
        images=(ImagePlacement(row=4, column="D", member_name="xl/media/image1.png"),),
    )

    result = review_sheets([sheet], "Client Catalog.xlsx", "f" * 64, "xlsx:client")

    assert result["mode"] == "review_only"
    assert result["persistenceSupported"] is False
    summary = result["summary"]
    assert isinstance(summary, dict)
    assert summary["itemCandidates"] == 1
    assert summary["variantCandidates"] == 2
    assert summary["formulaCellsIgnored"] == 1
    items = result["items"]
    assert isinstance(items, list)
    item = items[0]
    assert item["commerce"] == {"pricingMode": "fixed"}
    assert item["brochureStatus"] == "needs_publication"
    assert item["priceCandidates"] == []
    variants = item["variantCandidates"]
    assert variants[0]["commerce"] == {"pricingMode": "on_request"}
    assert variants[1]["priceCandidates"][0] == {
        "label": "Selling price",
        "amount": "19800",
        "currency": "AED",
        "status": "needs_review",
        "notSupplierCost": True,
        "missing": ["effectiveDate", "taxTreatment", "inclusions"],
    }
    assert item["mediaCandidates"][0]["role"] == "primary_image"


def test_review_understands_reversed_item_description_headers_and_enquiry_typo() -> None:
    sheet = SheetData(
        name="Decor",
        rows={
            3: {
                "B": Cell("DESCRIPTION"),
                "C": Cell("ITEM"),
                "D": Cell("IMAGE"),
                "E": Cell("PRICE (AED)"),
            },
            4: {"B": Cell("ARCH"), "C": Cell("Talia Travertine Arch"), "E": Cell("ENQUI")},
            5: {"B": Cell("ARCH"), "C": Cell("Sahara Travertine Arch"), "E": Cell("450")},
        },
    )

    result = review_sheets([sheet], "Decor.xlsx", "0" * 64, "xlsx:decor")
    items = result["items"]
    assert isinstance(items, list)
    assert [item["name"] for item in items] == ["Talia Travertine Arch", "Sahara Travertine Arch"]
    assert items[0]["itemType"] == "ARCH"
    assert items[0]["commerce"] == {"pricingMode": "on_request"}
    assert items[1]["commerce"] == {"pricingMode": "fixed"}


def test_review_reports_formulas_but_never_uses_cached_formula_prices() -> None:
    sheet = SheetData(
        name="Table",
        rows={
            3: {"B": Cell("ITEM"), "C": Cell("DESCRIPTION"), "E": Cell("PRICE (AED)")},
            4: {
                "B": Cell("TABLE"),
                "C": Cell("Calculated Table"),
                "E": Cell("5000", "2500*2"),
            },
        },
    )

    result = review_sheets([sheet], "Table.xlsx", "1" * 64, "xlsx:table")
    items = result["items"]
    assert isinstance(items, list)
    assert items[0]["commerce"] == {"pricingMode": "unpriced"}
    assert items[0]["priceCandidates"] == []
    issues = result["issues"]
    assert isinstance(issues, list)
    assert any(issue["code"] == "formula_ignored" and issue["cell"] == "E4" for issue in issues)
