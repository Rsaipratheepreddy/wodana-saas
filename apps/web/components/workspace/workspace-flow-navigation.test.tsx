import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WorkspaceFlowNavigation } from "./workspace-flow-navigation";
import { workspaceModules } from "./workspace-navigation";
let query = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
const root = "/workspace/pre-projects/cases/38b5a26d-0c2f-4608-8d4d-efe6024e7c3e";
it('shows no view switch on the Projects page; Planning has its own sidebar entry',()=>{
  query='';
  const view=render(<WorkspaceFlowNavigation module={workspaceModules[3]} pathname="/workspace/projects"/>);
  expect(view.container).toBeEmptyDOMElement();
});
it("opens planning sections within the same project with one active destination", () => {
  query="";
  render(<WorkspaceFlowNavigation module={workspaceModules[2]} pathname={`${root}/contracts`}/>);
  const nav=screen.getByRole("navigation",{name:"Planning sections"});
  expect(within(nav).getAllByRole("link")).toHaveLength(7);
  expect(within(nav).getByRole("link",{name:"Agreement"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Change requests"})).toHaveAttribute("href",`${root}/variations`);
  expect(screen.queryByRole("navigation",{name:"Commercial sections"})).not.toBeInTheDocument();
});
it("keeps redirected measurement views active and clears their query when leaving",()=>{
  query="tab=measurements";
  render(<WorkspaceFlowNavigation module={workspaceModules[2]} pathname={`${root}/requirements`}/>);
  expect(screen.getByRole("link",{name:"Measurements"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Design"})).toHaveAttribute("href",`${root}/designs`);
});
it("uses the same compact tab treatment for Sales",()=>{
  query="";
  render(<WorkspaceFlowNavigation module={workspaceModules[1]} pathname="/workspace/crm/leads"/>);
  expect(screen.getByRole("link",{name:"Enquiries"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Pipeline"})).toHaveAttribute("href","/workspace/crm/opportunities");
  const nav = screen.getByRole("navigation", {name:"Sales sections"});
  expect(nav.parentElement).toHaveAttribute("data-navigation", "chips");
  // Quiet text tabs: no decorative icons.
  for (const label of ["Enquiries", "Pipeline", "Campaigns", "Reports", "Settings"]) {
    expect(within(nav).getByRole("link", {name:label}).querySelector("img")).toBeNull();
  }
});

it("opens unpaid Deal preparation from Sales without adding a Projects tab",()=>{
  query="";
  render(<WorkspaceFlowNavigation module={workspaceModules[1]} pathname="/workspace/crm/preparation" canPreExecution/>);
  const nav=screen.getByRole('navigation',{name:'Sales sections'});
  expect(within(nav).getByRole('link',{name:'Preparation'})).toHaveAttribute('aria-current','page');
  expect(within(nav).getByRole('link',{name:'Preparation'})).toHaveAttribute('href','/workspace/crm/preparation');
});

it("keeps Reports selected and preserves Sales settings destinations", () => {
  query="section=reports";
  const {rerender}=render(<WorkspaceFlowNavigation module={workspaceModules[1]} pathname="/workspace/crm/leads"/>);
  expect(screen.getByRole("link",{name:"Reports"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Enquiries"})).not.toHaveAttribute("aria-current");
  query="section=assignment";
  rerender(<WorkspaceFlowNavigation module={workspaceModules[1]} pathname="/workspace/crm/leads"/>);
  expect(screen.getByRole("link",{name:"Settings"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Assignment"})).toHaveAttribute("href","/workspace/crm/leads?section=assignment");
});

it("follows the client planning order and clears review selection when changing sections",()=>{
  query="review=scope";
  render(<WorkspaceFlowNavigation module={workspaceModules[2]} pathname={`${root}/approvals`}/>);
  const links=within(screen.getByRole("navigation",{name:"Planning sections"})).getAllByRole("link");
  expect(links.map(link=>link.textContent)).toEqual(["Overview","Requirements","Site","Moodboard","Design","Quotes","Agreement"]);
  expect(screen.getByRole("link",{name:"Approvals"})).toHaveAttribute("aria-current","page");
  expect(screen.getByRole("link",{name:"Requirements"})).toHaveAttribute("href",`${root}/requirements`);
  expect(screen.getByRole("link",{name:"Approvals"})).not.toHaveAttribute("href",expect.stringContaining("review="));
});
