CREATE OR REPLACE PACKAGE BODY emp_pkg AS
  FUNCTION hire(p_name VARCHAR2) RETURN NUMBER IS
  BEGIN
    RETURN util_pkg.calc_salary(p_name);
  END;
END emp_pkg;
/
