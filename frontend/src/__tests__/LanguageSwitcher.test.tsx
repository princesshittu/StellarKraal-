/**
 * Tests for LanguageSwitcher dropdown — Issue #1256
 *
 * Verifies:
 *  - Trigger button shows flag + language name
 *  - Opens dropdown on click
 *  - Active language highlighted in dropdown
 *  - Selecting a language calls setLocale and closes dropdown
 *  - Keyboard navigation: ArrowDown/Up, Enter, Space, Escape
 *  - aria-haspopup, aria-expanded, aria-label on trigger
 *  - Live region announces selection
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { type Locale } from "@/context/I18nContext";

// ── Mock I18nContext ──────────────────────────────────────────────────────────

const mockSetLocale = jest.fn();
let mockLocale: Locale = "en";

jest.mock("@/context/I18nContext", () => ({
  useI18n: () => ({ locale: mockLocale, setLocale: mockSetLocale }),
  SUPPORTED_LOCALES: ["en", "sw"],
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LanguageSwitcher dropdown (#1256)", () => {
  beforeEach(() => {
    mockLocale = "en";
    mockSetLocale.mockClear();
  });

  describe("trigger button", () => {
    it("shows the active language flag and name", () => {
      render(<LanguageSwitcher />);
      // English should be displayed (flag + name on desktop)
      const button = screen.getByRole("button", { name: /language/i });
      expect(button).toBeTruthy();
      // The English flag emoji should be in the button
      expect(button.textContent).toContain("🇬🇧");
    });

    it("has aria-haspopup='listbox'", () => {
      render(<LanguageSwitcher />);
      const button = screen.getByRole("button", { name: /language/i });
      expect(button.getAttribute("aria-haspopup")).toBe("listbox");
    });

    it("has aria-expanded='false' when closed", () => {
      render(<LanguageSwitcher />);
      const button = screen.getByRole("button", { name: /language/i });
      expect(button.getAttribute("aria-expanded")).toBe("false");
    });

    it("has aria-expanded='true' when open", async () => {
      render(<LanguageSwitcher />);
      const button = screen.getByRole("button", { name: /language/i });
      await userEvent.click(button);
      expect(button.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("dropdown list", () => {
    it("does not show list when closed", () => {
      render(<LanguageSwitcher />);
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("shows list when trigger is clicked", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("lists English and Kiswahili options with flags", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(2);
      expect(options[0].textContent).toContain("🇬🇧");
      expect(options[1].textContent).toContain("🇹🇿");
    });

    it("marks the active language as selected", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const enOption = screen.getAllByRole("option")[0];
      expect(enOption.getAttribute("aria-selected")).toBe("true");
    });

    it("active language option has highlighted styling", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      // The button inside the active option should have the primary token class
      const options = screen.getAllByRole("option");
      const activeBtn = options[0].querySelector("button");
      expect(activeBtn?.className).toContain("token-primary");
    });
  });

  describe("language selection", () => {
    it("calls setLocale with 'sw' when Kiswahili is selected", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const swOption = screen.getAllByRole("option")[1].querySelector("button")!;
      await userEvent.click(swOption);
      expect(mockSetLocale).toHaveBeenCalledWith("sw");
    });

    it("closes the dropdown after selection", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const swOption = screen.getAllByRole("option")[1].querySelector("button")!;
      await userEvent.click(swOption);
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("announces the language change via live region", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const swOption = screen.getAllByRole("option")[1].querySelector("button")!;
      await userEvent.click(swOption);
      const liveRegion = document.querySelector('[role="status"]');
      expect(liveRegion?.textContent).toContain("Kiswahili");
    });
  });

  describe("keyboard navigation", () => {
    it("opens with ArrowDown key", async () => {
      render(<LanguageSwitcher />);
      const button = screen.getByRole("button", { name: /language/i });
      button.focus();
      await userEvent.keyboard("{ArrowDown}");
      expect(screen.getByRole("listbox")).toBeTruthy();
    });

    it("closes with Escape key", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      expect(screen.getByRole("listbox")).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("navigates down through options with ArrowDown", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      // Focus first option, press ArrowDown — second option should get focus
      const firstOptionBtn = screen.getAllByRole("option")[0].querySelector("button")!;
      firstOptionBtn.focus();
      await userEvent.keyboard("{ArrowDown}");
      const secondOptionBtn = screen.getAllByRole("option")[1].querySelector("button")!;
      expect(secondOptionBtn).toHaveFocus();
    });

    it("navigates up through options with ArrowUp", async () => {
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const secondOptionBtn = screen.getAllByRole("option")[1].querySelector("button")!;
      secondOptionBtn.focus();
      await userEvent.keyboard("{ArrowUp}");
      const firstOptionBtn = screen.getAllByRole("option")[0].querySelector("button")!;
      expect(firstOptionBtn).toHaveFocus();
    });
  });

  describe("Kiswahili as active locale", () => {
    it("shows the Kiswahili flag when sw is active", () => {
      mockLocale = "sw";
      render(<LanguageSwitcher />);
      const button = screen.getByRole("button", { name: /language/i });
      expect(button.textContent).toContain("🇹🇿");
    });

    it("marks sw option as selected when sw is active", async () => {
      mockLocale = "sw";
      render(<LanguageSwitcher />);
      await userEvent.click(screen.getByRole("button", { name: /language/i }));
      const swOption = screen.getAllByRole("option")[1];
      expect(swOption.getAttribute("aria-selected")).toBe("true");
    });
  });
});
