/**
 * Tests for AppraisalChangeIndicator — Issue #1257
 *
 * Verifies:
 *  - Green ↑ shown when new value > previous
 *  - Red ↓ shown when new value < previous
 *  - Nothing rendered when no previous appraisal
 *  - Percentage rounded to 1 decimal place
 *  - Colour-blind safe: arrow symbol present regardless of colour
 *  - Screen-reader text available
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import AppraisalChangeIndicator from "../components/AppraisalChangeIndicator";

describe("AppraisalChangeIndicator (#1257)", () => {
  describe("no previous appraisal", () => {
    it("renders nothing when previousValue is undefined", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={1000} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when previousValue is null", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={1000} previousValue={null} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("positive change (green ↑)", () => {
    it("renders the up arrow when value increased", () => {
      render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      expect(screen.getByText(/↑/)).toBeTruthy();
    });

    it("applies success colour class for positive change", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain("token-success");
    });

    it("shows 10.0% for a 10% increase", () => {
      render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      expect(screen.getAllByText(/10\.0%/).length).toBeGreaterThan(0);
    });

    it("rounds to 1 decimal place (e.g. 12.3%)", () => {
      // 1123 / 1000 = 1.123 → +12.3%
      render(
        <AppraisalChangeIndicator currentValue={1123} previousValue={1000} />
      );
      expect(screen.getAllByText(/12\.3%/).length).toBeGreaterThan(0);
    });

    it("has an accessible label describing the increase", () => {
      render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      const indicator = screen.getByLabelText(/increased by 10\.0%/i);
      expect(indicator).toBeTruthy();
    });

    it("includes sr-only text 'increased by X%' for screen readers", () => {
      render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      const srText = screen.getByText(/increased by 10\.0%/i);
      expect(srText.className).toContain("sr-only");
    });
  });

  describe("negative change (red ↓)", () => {
    it("renders the down arrow when value decreased", () => {
      render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      expect(screen.getByText(/↓/)).toBeTruthy();
    });

    it("applies danger colour class for negative change", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      const el = container.firstChild as HTMLElement;
      expect(el.className).toContain("token-danger");
    });

    it("shows 10.0% for a 10% decrease", () => {
      render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      expect(screen.getAllByText(/10\.0%/).length).toBeGreaterThan(0);
    });

    it("has an accessible label describing the decrease", () => {
      render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      const indicator = screen.getByLabelText(/decreased by 10\.0%/i);
      expect(indicator).toBeTruthy();
    });

    it("includes sr-only text 'decreased by X%' for screen readers", () => {
      render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      const srText = screen.getByText(/decreased by 10\.0%/i);
      expect(srText.className).toContain("sr-only");
    });
  });

  describe("edge cases", () => {
    it("renders nothing when values are identical (0% change)", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={1000} previousValue={1000} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when previousValue is 0 (division by zero)", () => {
      const { container } = render(
        <AppraisalChangeIndicator currentValue={500} previousValue={0} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("accepts an additional className prop", () => {
      const { container } = render(
        <AppraisalChangeIndicator
          currentValue={1100}
          previousValue={1000}
          className="ml-2"
        />
      );
      expect((container.firstChild as HTMLElement).className).toContain("ml-2");
    });

    it("colour-blind safe: arrow is always present regardless of colour", () => {
      // Positive
      const { unmount } = render(
        <AppraisalChangeIndicator currentValue={1100} previousValue={1000} />
      );
      expect(screen.getByText(/↑/)).toBeTruthy();
      unmount();

      // Negative
      render(
        <AppraisalChangeIndicator currentValue={900} previousValue={1000} />
      );
      expect(screen.getByText(/↓/)).toBeTruthy();
    });
  });
});
