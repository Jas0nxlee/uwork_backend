import unittest
from owned_chrome_tab_witness import empty_children_result


class NativeTreeReadTests(unittest.TestCase):
    def test_missing_children_and_unsupported_attribute_are_valid_leaves(self):
        self.assertTrue(empty_children_result(-25205))
        self.assertTrue(empty_children_result(-25212))

    def test_busy_app_disabled_api_and_invalid_handle_are_not_absence(self):
        for error in [-25204, -25211, -25202, -25200]:
            with self.subTest(error=error):
                self.assertFalse(empty_children_result(error))


if __name__ == '__main__':
    unittest.main()
