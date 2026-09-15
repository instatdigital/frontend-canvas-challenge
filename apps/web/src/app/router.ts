import { createBrowserRouter } from "react-router";
import { SpacePage } from "../pages/space";

export const routes = createBrowserRouter([
  {
    path: "/",
    element: SpacePage(),
  },
]);