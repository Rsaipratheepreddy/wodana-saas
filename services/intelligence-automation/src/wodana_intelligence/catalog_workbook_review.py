"""Read-only XLSX catalog review.

This module deliberately has no database, HTTP, tenant, or catalog write dependency.
It turns a workbook into review candidates; a separate approved workflow must map
those candidates to catalog commands.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import cast
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
DRAWING_MAIN_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
NAMESPACES = {
    "m": MAIN_NS,
    "r": OFFICE_REL_NS,
    "pr": PACKAGE_REL_NS,
    "xdr": DRAWING_NS,
    "a": DRAWING_MAIN_NS,
}
REL_ID = f"{{{OFFICE_REL_NS}}}id"
EMBED_ID = f"{{{OFFICE_REL_NS}}}embed"
MAX_WORKBOOK_BYTES = 250 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_ROWS = 200_000
NAMESPACE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,119}$")
PRICE_REQUEST_PATTERN = re.compile(r"\b(?:ENQUI\w*|PRICE\s+ENQUI\w*)\b", re.IGNORECASE)


@dataclass(frozen=True)
class Cell:
    value: str | None
    formula: str | None = None


@dataclass(frozen=True)
class ImagePlacement:
    row: int
    column: str
    member_name: str


@dataclass(frozen=True)
class SheetData:
    name: str
    rows: dict[int, dict[str, Cell]]
    images: tuple[ImagePlacement, ...] = ()


@dataclass(frozen=True)
class PriceState:
    mode: str
    amount: str | None
    original: str


def review_workbook(path: Path, namespace: str) -> dict[str, object]:
    """Return a deterministic review plan without modifying the workbook or any system."""
    if not NAMESPACE_PATTERN.fullmatch(namespace):
        raise ValueError("Namespace must be a lowercase stable identifier.")
    if not path.is_file():
        raise ValueError("Workbook not found.")
    if path.suffix.lower() != ".xlsx":
        raise ValueError("Only .xlsx catalog workbooks are supported for review.")
    if path.stat().st_size > MAX_WORKBOOK_BYTES:
        raise ValueError("Workbook is too large to review safely.")
    source_hash = _file_sha256(path)
    try:
        with ZipFile(path) as archive:
            if sum(info.file_size for info in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("Workbook expands beyond the safe review limit.")
            sheets = _read_sheets(archive)
    except BadZipFile as error:
        raise ValueError("The file is not a valid XLSX workbook.") from error
    return review_sheets(sheets, path.name, source_hash, namespace)


def review_sheets(
    sheets: list[SheetData],
    source_name: str,
    source_hash: str,
    namespace: str,
) -> dict[str, object]:
    candidates: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []
    ignored_sheets: list[str] = []
    formula_count = 0
    for sheet in sheets:
        sheet_candidates, sheet_issues, formulas = _review_sheet(sheet, namespace)
        formula_count += formulas
        if not sheet_candidates:
            ignored_sheets.append(sheet.name)
        candidates.extend(sheet_candidates)
        issues.extend(sheet_issues)
    pricing_counts = {mode: 0 for mode in ("fixed", "on_request", "unpriced")}
    variant_count = 0
    image_count = 0
    drawing_count = 0
    brochure_count = 0
    for candidate in candidates:
        mode = str(candidate["commerce"]["pricingMode"])  # type: ignore[index]
        pricing_counts[mode] += 1
        variant_count += len(cast(list[object], candidate["variantCandidates"]))
        media = cast(list[dict[str, object]], candidate["mediaCandidates"])
        image_count += sum(item["role"] != "technical_drawing" for item in media)
        drawing_count += sum(item["role"] == "technical_drawing" for item in media)
        brochure_count += candidate["brochureStatus"] == "needs_publication"
    return {
        "mode": "review_only",
        "persistenceSupported": False,
        "source": {
            "fileName": source_name,
            "sha256": source_hash,
            "namespace": namespace,
        },
        "summary": {
            "sheetCount": len(sheets),
            "ignoredSheets": ignored_sheets,
            "itemCandidates": len(candidates),
            "variantCandidates": variant_count,
            "fixedPriceItems": pricing_counts["fixed"],
            "priceOnRequestItems": pricing_counts["on_request"],
            "unpricedItems": pricing_counts["unpriced"],
            "imagePlacements": image_count,
            "technicalDrawingPlacements": drawing_count,
            "needsBrochurePublication": brochure_count,
            "formulaCellsIgnored": formula_count,
            "issues": len(issues),
        },
        "items": candidates,
        "issues": issues,
    }


def _review_sheet(
    sheet: SheetData, namespace: str
) -> tuple[list[dict[str, object]], list[dict[str, object]], int]:
    header_row = _find_header_row(sheet)
    formulas = [
        (row_number, column, cell.formula)
        for row_number, row in sheet.rows.items()
        for column, cell in row.items()
        if cell.formula
    ]
    if header_row is None:
        return [], [], len(formulas)
    headers = {
        column: _clean(cell.value)
        for column, cell in sheet.rows[header_row].items()
        if _clean(cell.value)
    }
    price_columns = [column for column, value in headers.items() if "PRICE" in value.upper()]
    if not price_columns:
        return [], [], len(formulas)
    name_column, type_column = _choose_identity_columns(sheet, header_row, headers)
    if not name_column:
        return [], [], len(formulas)
    remark_column = next(
        (column for column, value in headers.items() if "REMARK" in value.upper()), None
    )
    dimension_columns = [
        column
        for column, value in headers.items()
        if any(
            word in value.upper()
            for word in ("HEIGHT", "LENGTH", "WIDTH", "DEPTH", "DIAMETER", "SIZE")
        )
        and column not in price_columns
    ]
    image_headers = {
        column: value
        for column, value in headers.items()
        if "IMAGE" in value.upper() or "DRAWING" in value.upper()
    }
    rows: list[dict[str, object]] = []
    for row_number in sorted(number for number in sheet.rows if number > header_row):
        sheet_row = sheet.rows[row_number]
        name = _clean(_literal(sheet_row.get(name_column)))
        if not name:
            continue
        item_type = (
            _clean(_literal(sheet_row.get(type_column)))
            if type_column
            else sheet.name
        )
        item_type = item_type or sheet.name
        prices = {
            column: _price_state(_literal(sheet_row.get(column)))
            for column in price_columns
        }
        attributes = [
            {
                "name": headers[column],
                "value": _clean(_literal(sheet_row.get(column))),
            }
            for column in dimension_columns
            if _clean(_literal(sheet_row.get(column)))
        ]
        remarks = (
            _clean(_literal(sheet_row.get(remark_column))) if remark_column else ""
        )
        media = _row_media(sheet, row_number, image_headers)
        raw = {
            column: {"value": cell.value, "formula": cell.formula}
            for column, cell in sorted(sheet_row.items())
            if cell.value is not None or cell.formula is not None
        }
        rows.append(
            {
                "row": row_number,
                "name": name,
                "itemType": item_type,
                "prices": prices,
                "attributes": attributes,
                "remarks": remarks,
                "media": media,
                "fingerprint": _fingerprint(raw),
            }
        )
    grouped: dict[tuple[str, str], list[dict[str, object]]] = {}
    for candidate_row in rows:
        key = (
            _slug(str(candidate_row["itemType"])),
            _slug(str(candidate_row["name"])),
        )
        grouped.setdefault(key, []).append(candidate_row)
    candidates: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []
    for (type_key, name_key), group in grouped.items():
        first = group[0]
        source_key = f"{_slug(sheet.name)}/{type_key}/{name_key}"
        is_variant_group = len(group) > 1 or len(price_columns) > 1
        variants = (
            _variants(
                group,
                price_columns,
                headers,
                source_key,
                namespace,
                sheet.name,
            )
            if is_variant_group
            else []
        )
        states = [
            state
            for row in group
            for state in cast(dict[str, PriceState], row["prices"]).values()
        ]
        pricing_mode = _combined_mode(states)
        fingerprints = sorted(str(row["fingerprint"]) for row in group)
        provenance = {
            "namespace": namespace,
            "sourceKey": source_key,
            "sourceFingerprint": _fingerprint(fingerprints),
            "reviewStatus": "needs_review",
            "sourceSheet": sheet.name,
            "sourceRow": min(cast(int, row["row"]) for row in group),
        }
        media = [
            item
            for row in group
            for item in cast(list[dict[str, object]], row["media"])
        ]
        candidate: dict[str, object] = {
            "kind": "work",
            "name": first["name"],
            "itemType": first["itemType"],
            "commerce": {"pricingMode": pricing_mode},
            "provenance": provenance,
            "attributes": first["attributes"] if not is_variant_group else [],
            "priceCandidates": []
            if is_variant_group
            else _price_candidates(
                cast(dict[str, PriceState], first["prices"]), price_columns, headers
            ),
            "variantCandidates": variants,
            "mediaCandidates": media,
            "brochureStatus": "needs_publication"
            if any(
                "ADD" in str(row["remarks"]).upper()
                and "BROCHURE" in str(row["remarks"]).upper()
                for row in group
            )
            else "unchanged",
            "remarks": sorted({str(row["remarks"]) for row in group if row["remarks"]}),
        }
        candidates.append(candidate)
        if len(group) > 1:
            issues.append(
                {
                    "code": "duplicate_name_grouped_as_variants",
                    "sheet": sheet.name,
                    "rows": [row["row"] for row in group],
                    "sourceKey": source_key,
                }
            )
        if not media:
            issues.append(
                {
                    "code": "missing_product_image",
                    "sheet": sheet.name,
                    "rows": [row["row"] for row in group],
                    "sourceKey": source_key,
                }
            )
        if pricing_mode == "fixed":
            issues.append(
                {
                    "code": "selling_price_terms_required",
                    "sheet": sheet.name,
                    "rows": [row["row"] for row in group],
                    "sourceKey": source_key,
                    "missing": ["effectiveDate", "taxTreatment", "inclusions"],
                }
            )
        invalid_prices = [state.original for state in states if state.mode == "invalid"]
        if invalid_prices:
            issues.append(
                {
                    "code": "invalid_price_value",
                    "sheet": sheet.name,
                    "rows": [row["row"] for row in group],
                    "sourceKey": source_key,
                    "values": invalid_prices,
                }
            )
    for row_number, column, formula in formulas:
        issues.append(
            {
                "code": "formula_ignored",
                "sheet": sheet.name,
                "cell": f"{column}{row_number}",
                "formula": formula,
            }
        )
    return candidates, issues, len(formulas)


def _variants(
    group: list[dict[str, object]],
    price_columns: list[str],
    headers: dict[str, str],
    parent_key: str,
    namespace: str,
    sheet_name: str,
) -> list[dict[str, object]]:
    variants: list[dict[str, object]] = []
    seen: dict[str, int] = {}
    for row in group:
        row_prices = cast(dict[str, PriceState], row["prices"])
        for price_column in price_columns:
            state = row_prices[price_column]
            dimensions = cast(list[dict[str, str]], row["attributes"])
            labels = [str(item["value"]) for item in dimensions]
            if len(price_columns) > 1:
                labels.insert(0, _price_label(headers[price_column]))
            signature = " | ".join(label for label in labels if label) or (
                f"Option {len(variants) + 1}"
            )
            signature_key = _slug(signature)
            seen[signature_key] = seen.get(signature_key, 0) + 1
            suffix = f"-{seen[signature_key]}" if seen[signature_key] > 1 else ""
            source_key = f"{parent_key}/variant/{signature_key}{suffix}"
            variants.append(
                {
                    "kind": "variant",
                    "name": signature,
                    "commerce": {
                        "pricingMode": state.mode if state.mode != "invalid" else "unpriced"
                    },
                    "attributes": dimensions,
                    "priceCandidates": _price_candidates(
                        {price_column: state}, [price_column], headers
                    ),
                    "provenance": {
                        "namespace": namespace,
                        "sourceKey": source_key,
                        "sourceFingerprint": _fingerprint(
                            [row["fingerprint"], price_column, state.original]
                        ),
                        "reviewStatus": "needs_review",
                        "sourceSheet": sheet_name,
                        "sourceRow": row["row"],
                    },
                }
            )
    return variants


def _price_candidates(
    prices: dict[str, PriceState],
    columns: list[str],
    headers: dict[str, str],
) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for column in columns:
        state = prices[column]
        if state.mode != "fixed":
            continue
        result.append(
            {
                "label": _price_label(headers[column]),
                "amount": state.amount,
                "currency": "AED",
                "status": "needs_review",
                "notSupplierCost": True,
                "missing": ["effectiveDate", "taxTreatment", "inclusions"],
            }
        )
    return result


def _row_media(
    sheet: SheetData, row_number: int, image_headers: dict[str, str]
) -> list[dict[str, object]]:
    media: list[dict[str, object]] = []
    for image in sheet.images:
        if image.row != row_number:
            continue
        header = image_headers.get(image.column, "IMAGE").upper()
        media.append(
            {
                "role": "technical_drawing" if "DRAWING" in header else "primary_image",
                "workbookMember": image.member_name,
                "sourceCell": f"{image.column}{image.row}",
                "status": "needs_review",
            }
        )
    for index, item in enumerate(media):
        if item["role"] == "primary_image" and any(
            earlier["role"] == "primary_image" for earlier in media[:index]
        ):
            item["role"] = "gallery_image"
    return media


def _choose_identity_columns(
    sheet: SheetData, header_row: int, headers: dict[str, str]
) -> tuple[str | None, str | None]:
    candidates = [
        column
        for column, value in headers.items()
        if value.upper() in {"ITEM", "DESCRIPTION", "NAME", "PRODUCT", "PRODUCT NAME"}
    ]
    if not candidates:
        return None, None
    samples: dict[str, list[str]] = {}
    for column in candidates:
        samples[column] = [
            _clean(_literal(row.get(column)))
            for number, row in sheet.rows.items()
            if number > header_row and _clean(_literal(row.get(column)))
        ]
    name_column = max(
        candidates,
        key=lambda column: (
            len({value.casefold() for value in samples[column]}),
            sum(len(value) for value in samples[column]) / max(len(samples[column]), 1),
        ),
    )
    type_candidates = [column for column in candidates if column != name_column]
    return name_column, type_candidates[0] if type_candidates else None


def _find_header_row(sheet: SheetData) -> int | None:
    for row_number in sorted(sheet.rows):
        values = [_clean(cell.value).upper() for cell in sheet.rows[row_number].values()]
        if any("PRICE" in value for value in values) and any(
            value in {"ITEM", "DESCRIPTION", "NAME", "PRODUCT", "PRODUCT NAME"}
            for value in values
        ):
            return row_number
    return None


def _price_state(value: str | None) -> PriceState:
    original = _clean(value)
    if not original:
        return PriceState("unpriced", None, "")
    if PRICE_REQUEST_PATTERN.search(original):
        return PriceState("on_request", None, original)
    normalized = original.replace(",", "").replace("AED", "").strip()
    try:
        amount = Decimal(normalized)
    except InvalidOperation:
        return PriceState("invalid", None, original)
    if not amount.is_finite() or amount < 0:
        return PriceState("invalid", None, original)
    return PriceState("fixed", format(amount.normalize(), "f"), original)


def _combined_mode(states: list[PriceState]) -> str:
    if any(state.mode == "fixed" for state in states):
        return "fixed"
    if any(state.mode == "on_request" for state in states):
        return "on_request"
    return "unpriced"


def _price_label(header: str) -> str:
    label = re.sub(r"(?i)^PRICE\s*\(AED\)\s*-?\s*", "", header).strip(" -()")
    return label or "Selling price"


def _read_sheets(archive: ZipFile) -> list[SheetData]:
    members = set(archive.namelist())
    if "xl/workbook.xml" not in members:
        raise ValueError("Workbook structure is missing.")
    shared_strings = _shared_strings(archive, members)
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = _relationships(archive, "xl/_rels/workbook.xml.rels", members)
    sheets: list[SheetData] = []
    total_rows = 0
    for element in workbook.findall(".//m:sheets/m:sheet", NAMESPACES):
        name = element.attrib.get("name", "Sheet")
        relation_id = element.attrib.get(REL_ID)
        target = relationships.get(relation_id or "")
        if not target:
            continue
        member = _resolve_member("xl/workbook.xml", target)
        if member not in members:
            continue
        root = ElementTree.fromstring(archive.read(member))
        rows: dict[int, dict[str, Cell]] = {}
        for row in root.findall(".//m:sheetData/m:row", NAMESPACES):
            row_number = int(row.attrib.get("r", "0"))
            cells: dict[str, Cell] = {}
            for element_cell in row.findall("m:c", NAMESPACES):
                reference = element_cell.attrib.get("r", "")
                match = re.match(r"[A-Z]+", reference)
                if not match:
                    continue
                column = match.group(0)
                formula_element = element_cell.find("m:f", NAMESPACES)
                formula = formula_element.text if formula_element is not None else None
                value = _cell_value(element_cell, shared_strings)
                if value is not None or formula is not None:
                    cells[column] = Cell(value, formula)
            if cells:
                rows[row_number] = cells
        total_rows += len(rows)
        if total_rows > MAX_ROWS:
            raise ValueError("Workbook contains too many rows to review safely.")
        sheets.append(
            SheetData(
                name=name,
                rows=rows,
                images=_sheet_images(archive, member, root, members),
            )
        )
    return sheets


def _shared_strings(archive: ZipFile, members: set[str]) -> list[str]:
    if "xl/sharedStrings.xml" not in members:
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.findall(".//m:t", NAMESPACES))
        for item in root.findall("m:si", NAMESPACES)
    ]


def _cell_value(element: ElementTree.Element, shared_strings: list[str]) -> str | None:
    cell_type = element.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in element.findall(".//m:t", NAMESPACES))
    value_element = element.find("m:v", NAMESPACES)
    if value_element is None or value_element.text is None:
        return None
    if cell_type == "s":
        try:
            return shared_strings[int(value_element.text)]
        except (ValueError, IndexError):
            return None
    return value_element.text


def _sheet_images(
    archive: ZipFile,
    sheet_member: str,
    sheet_root: ElementTree.Element,
    members: set[str],
) -> tuple[ImagePlacement, ...]:
    relation_member = posixpath.join(
        posixpath.dirname(sheet_member),
        "_rels",
        f"{posixpath.basename(sheet_member)}.rels",
    )
    sheet_relationships = _relationships(archive, relation_member, members)
    placements: list[ImagePlacement] = []
    for drawing in sheet_root.findall("m:drawing", NAMESPACES):
        target = sheet_relationships.get(drawing.attrib.get(REL_ID, ""))
        if not target:
            continue
        drawing_member = _resolve_member(sheet_member, target)
        if drawing_member not in members:
            continue
        drawing_root = ElementTree.fromstring(archive.read(drawing_member))
        relation_path = posixpath.join(
            posixpath.dirname(drawing_member),
            "_rels",
            f"{posixpath.basename(drawing_member)}.rels",
        )
        drawing_relationships = _relationships(archive, relation_path, members)
        for anchor in list(drawing_root.findall("xdr:oneCellAnchor", NAMESPACES)) + list(
            drawing_root.findall("xdr:twoCellAnchor", NAMESPACES)
        ):
            row_element = anchor.find("xdr:from/xdr:row", NAMESPACES)
            column_element = anchor.find("xdr:from/xdr:col", NAMESPACES)
            blip = anchor.find(".//a:blip", NAMESPACES)
            if row_element is None or column_element is None or blip is None:
                continue
            target = drawing_relationships.get(blip.attrib.get(EMBED_ID, ""))
            if not target:
                continue
            placements.append(
                ImagePlacement(
                    row=int(row_element.text or "0") + 1,
                    column=_column_name(int(column_element.text or "0") + 1),
                    member_name=_resolve_member(drawing_member, target),
                )
            )
    return tuple(placements)


def _relationships(archive: ZipFile, member: str, members: set[str]) -> dict[str, str]:
    if member not in members:
        return {}
    root = ElementTree.fromstring(archive.read(member))
    return {
        relationship.attrib["Id"]: relationship.attrib["Target"]
        for relationship in root.findall("pr:Relationship", NAMESPACES)
        if "Id" in relationship.attrib
        and "Target" in relationship.attrib
        and relationship.attrib.get("TargetMode") != "External"
    }


def _resolve_member(source_member: str, target: str) -> str:
    if target.startswith("/"):
        return posixpath.normpath(target.lstrip("/"))
    return posixpath.normpath(posixpath.join(posixpath.dirname(source_member), target))


def _column_name(number: int) -> str:
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _literal(cell: Cell | None) -> str | None:
    return cell.value if cell is not None and cell.formula is None else None


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug[:120] or "unnamed"


def _fingerprint(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a read-only catalog workbook review plan.")
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--summary-only", action="store_true")
    arguments = parser.parse_args()
    result = review_workbook(arguments.workbook, arguments.namespace)
    output: object = (
        {
            "mode": result["mode"],
            "persistenceSupported": False,
            "source": result["source"],
            "summary": result["summary"],
        }
        if arguments.summary_only
        else result
    )
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
