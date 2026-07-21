import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddNewMemberDialog from "../settings/AddNewMemberDialog";

describe("AddNewMemberDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    handleInviteMember: vi.fn(),
  };

  it("renders dialog content when open", () => {
    render(<AddNewMemberDialog {...defaultProps} />);

    expect(screen.getByText("Invite member")).toBeInTheDocument();
    expect(screen.getByLabelText("Member email address")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(<AddNewMemberDialog {...defaultProps} open={false} />);

    expect(screen.queryByText("Invite member")).not.toBeInTheDocument();
  });

  it("add member button is disabled with empty email", () => {
    render(<AddNewMemberDialog {...defaultProps} />);

    const button = screen.getByRole("button", { name: "Add member" });
    expect(button).toBeDisabled();
  });

  it("defaults to Member role", () => {
    render(<AddNewMemberDialog {...defaultProps} />);

    expect(screen.getByLabelText("Member role")).toBeInTheDocument();
  });

  it("calls handleInviteMember with email and role on submit", async () => {
    const handleInviteMember = vi.fn();
    render(
      <AddNewMemberDialog
        {...defaultProps}
        handleInviteMember={handleInviteMember}
      />
    );

    const emailInput = screen.getByLabelText("Member email address");
    await userEvent.type(emailInput, "test@example.com");

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Add member" });
      expect(button).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(handleInviteMember).toHaveBeenCalledWith(
      "test@example.com",
      "member"
    );
  });

  it("shows valid styling when email is valid", async () => {
    render(<AddNewMemberDialog {...defaultProps} />);

    const emailInput = screen.getByLabelText("Member email address");
    await userEvent.type(emailInput, "valid@example.com");

    await waitFor(() => {
      expect(emailInput.className).toContain("border-valid-green");
    });
  });
});
